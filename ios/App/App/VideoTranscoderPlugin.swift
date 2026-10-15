import AVFoundation
import Capacitor
import Foundation

/// 動画を、決めた画質（短い辺の画素数・ビットレート）の MP4（H.264・AAC）に作り直す。
/// アルバム・標準のカメラの大きな動画や、日がたった高画質の動画を軽くするのに使う。
/// 場所は、アプリの書類（Filesystem の Directory.Data）からの相対パスで受け取る
@objc(VideoTranscoderPlugin)
public class VideoTranscoderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VideoTranscoderPlugin"
    public let jsName = "VideoTranscoder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "transcode", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "lattecho.transcode")

    @objc func transcode(_ call: CAPPluginCall) {
        guard let input = call.getString("input"), let output = call.getString("output") else {
            call.reject("input と output が要ります")
            return
        }
        let maxShortSide = CGFloat(call.getInt("maxShortSide") ?? 720)
        let videoBitrate = call.getInt("videoBitrate") ?? 1_200_000
        let audioBitrate = call.getInt("audioBitrate") ?? 96_000
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let inURL = docs.appendingPathComponent(input)
        let outURL = docs.appendingPathComponent(output)

        Task {
            do {
                let result = try await Self.run(
                    inURL: inURL, outURL: outURL, maxShortSide: maxShortSide,
                    videoBitrate: videoBitrate, audioBitrate: audioBitrate, queue: queue)
                call.resolve(result)
            } catch {
                try? FileManager.default.removeItem(at: outURL)
                call.reject("動画を作り直せませんでした: \(error.localizedDescription)")
            }
        }
    }

    private static func run(
        inURL: URL, outURL: URL, maxShortSide: CGFloat, videoBitrate: Int, audioBitrate: Int, queue: DispatchQueue
    ) async throws -> [String: Any] {
        let asset = AVURLAsset(url: inURL)
        guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else {
            throw NSError(domain: "lattecho", code: 1, userInfo: [NSLocalizedDescriptionKey: "映像がありません"])
        }
        let audioTrack = try await asset.loadTracks(withMediaType: .audio).first
        let (natural, transform, dataRate) = try await videoTrack.load(.naturalSize, .preferredTransform, .estimatedDataRate)
        let shortSide = min(abs(natural.width), abs(natural.height))

        // すでに決めた画質以下なら、作り直さない（画質を落とすだけになるので）
        if shortSide <= maxShortSide * 1.05 && Double(dataRate) <= Double(videoBitrate) * 1.3 {
            return ["skipped": true]
        }

        let scale = min(1, maxShortSide / shortSide)
        let even = { (v: CGFloat) -> Int in max(2, Int((v * scale / 2).rounded()) * 2) }
        let width = even(abs(natural.width))
        let height = even(abs(natural.height))

        try? FileManager.default.removeItem(at: outURL)
        let reader = try AVAssetReader(asset: asset)
        let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true

        let videoOut = AVAssetReaderTrackOutput(
            track: videoTrack,
            outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
        videoOut.alwaysCopiesSampleData = false
        reader.add(videoOut)
        let videoIn = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
                AVVideoScalingModeKey: AVVideoScalingModeResizeAspectFill,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: videoBitrate,
                    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                ],
            ])
        // 縦の動画の向きは、映像を回さずに向きの情報として残す（元の動画と同じ）
        videoIn.transform = transform
        videoIn.expectsMediaDataInRealTime = false
        writer.add(videoIn)

        var pairs: [(AVAssetReaderOutput, AVAssetWriterInput)] = [(videoOut, videoIn)]
        if let audioTrack {
            let audioOut = AVAssetReaderTrackOutput(
                track: audioTrack,
                outputSettings: [
                    AVFormatIDKey: kAudioFormatLinearPCM,
                    AVSampleRateKey: 44_100,
                    AVNumberOfChannelsKey: 2,
                    AVLinearPCMBitDepthKey: 16,
                    AVLinearPCMIsFloatKey: false,
                    AVLinearPCMIsBigEndianKey: false,
                    AVLinearPCMIsNonInterleaved: false,
                ])
            reader.add(audioOut)
            let audioIn = AVAssetWriterInput(
                mediaType: .audio,
                outputSettings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVSampleRateKey: 44_100,
                    AVNumberOfChannelsKey: 2,
                    AVEncoderBitRateKey: audioBitrate,
                ])
            audioIn.expectsMediaDataInRealTime = false
            writer.add(audioIn)
            pairs.append((audioOut, audioIn))
        }

        guard reader.startReading() else { throw reader.error ?? NSError(domain: "lattecho", code: 2) }
        guard writer.startWriting() else { throw writer.error ?? NSError(domain: "lattecho", code: 3) }
        writer.startSession(atSourceTime: .zero)

        await withTaskGroup(of: Void.self) { group in
            for (out, input) in pairs {
                group.addTask {
                    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                        var finished = false
                        input.requestMediaDataWhenReady(on: queue) {
                            while input.isReadyForMoreMediaData && !finished {
                                if writer.status == .writing, reader.status == .reading, let sample = out.copyNextSampleBuffer() {
                                    if !input.append(sample) { finished = true }
                                } else {
                                    finished = true
                                }
                                if finished {
                                    input.markAsFinished()
                                    done.resume()
                                }
                            }
                        }
                    }
                }
            }
        }

        if reader.status == .failed {
            writer.cancelWriting()
            throw reader.error ?? NSError(domain: "lattecho", code: 4)
        }
        await writer.finishWriting()
        if writer.status != .completed { throw writer.error ?? NSError(domain: "lattecho", code: 5) }

        let size = (try? FileManager.default.attributesOfItem(atPath: outURL.path)[.size] as? Int) ?? 0
        return ["skipped": false, "size": size, "width": width, "height": height]
    }
}
