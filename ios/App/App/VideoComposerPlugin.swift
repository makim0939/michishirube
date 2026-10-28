import AVFoundation
import Capacitor
import Foundation

/// 複数の動画から、指定した区間を切り出し、順につないで 1 本の MP4（H.264・AAC）にする。
/// 切り取りもこれで行う（1 本・1 区間のつなぎ）。ハードウェアで書き出すので、実時間より速い。
/// 場所は、アプリの書類（Filesystem の Directory.Data）からの相対パスで受け取る
@objc(VideoComposerPlugin)
public class VideoComposerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VideoComposerPlugin"
    public let jsName = "VideoComposer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "compose", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "lattecho.compose")

    private struct Bgm {
        let url: URL
        let volume: Float
    }

    private struct Clip {
        let url: URL
        let start: Double
        let end: Double
    }

    @objc func compose(_ call: CAPPluginCall) {
        guard let rawClips = call.getArray("clips") as? [[String: Any]], !rawClips.isEmpty,
            let output = call.getString("output")
        else {
            call.reject("clips と output が要ります")
            return
        }
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        var clips: [Clip] = []
        for raw in rawClips {
            guard let input = raw["input"] as? String else {
                call.reject("clips の input が要ります")
                return
            }
            let start = (raw["start"] as? NSNumber)?.doubleValue ?? 0
            // end が無ければ、動画の終わりまで（-1）
            let end = (raw["end"] as? NSNumber)?.doubleValue ?? -1
            clips.append(Clip(url: docs.appendingPathComponent(input), start: start, end: end))
        }
        let maxShortSide = CGFloat(call.getInt("maxShortSide") ?? 720)
        let videoBitrate = call.getInt("videoBitrate") ?? 1_200_000
        let audioBitrate = call.getInt("audioBitrate") ?? 96_000
        let outURL = docs.appendingPathComponent(output)
        // 元の動画の音を使わない（BGM だけ、または無音にする）
        let muteOriginal = call.getBool("muteOriginal") ?? false
        // BGM（任意）。入力のファイルと、音量（0〜1）。動画の長さまで繰り返し、終わりの 1.5 秒で小さくしていく
        var bgm: Bgm?
        if let raw = call.getObject("bgm"), let input = raw["input"] as? String {
            let volume = (raw["volume"] as? NSNumber)?.floatValue ?? 0.3
            bgm = Bgm(url: docs.appendingPathComponent(input), volume: max(0, min(1, volume)))
        }

        let watchdog = Watchdog()
        let once = Once()
        Task {
            do {
                let result = try await Self.run(
                    clips: clips, bgm: bgm, muteOriginal: muteOriginal, outURL: outURL, maxShortSide: maxShortSide,
                    videoBitrate: videoBitrate, audioBitrate: audioBitrate, queue: queue, watchdog: watchdog)
                watchdog.enter(.done)
                once.run { call.resolve(result) }
            } catch {
                watchdog.enter(.done)
                try? FileManager.default.removeItem(at: outURL)
                let reason = watchdog.timedOut ? "進まなくなったので止めました" : error.localizedDescription
                once.run { call.reject("動画をつなげませんでした: \(reason)") }
            }
        }
        // 見張り：進みが止まったら、読み込み・書き出しをやめさせる。それでも戻らなければ、こちらから失敗を返す
        Task {
            var expiredAt: Date?
            while true {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if let at = expiredAt {
                    if Date().timeIntervalSince(at) > 20 {
                        try? FileManager.default.removeItem(at: outURL)
                        once.run { call.reject("動画をつなげませんでした: 進まなくなったので止めました") }
                        return
                    }
                } else if watchdog.expired(finishLimit: 180) {
                    expiredAt = Date()
                    // 止める処理が戻らないこともあるので、見張りは待たない（20 秒たったら、こちらから失敗を返す）
                    DispatchQueue.global().async { watchdog.abort() }
                }
                if watchdog.isDone { return }
            }
        }
    }

    /// 書き出しの進みを見張る。サンプルを書き進めるたびに touch() し、一定時間進まなければ止める
    /// （長い動画で、書き出しが戻らないまま、画面から抜けられなくなるのを防ぐ）
    private final class Watchdog {
        enum Phase { case writing, finishing, done }
        private let lock = NSLock()
        private var last = Date()
        private var phase = Phase.writing
        private var expiredFlag = false

        var timedOut: Bool {
            lock.lock()
            defer { lock.unlock() }
            return expiredFlag
        }
        private var stop: (() -> Void)?

        /// 止める処理（読み込み・書き出しをやめる）。読み込みを始める前に入れる
        func setAbort(_ body: @escaping () -> Void) {
            lock.lock()
            stop = body
            lock.unlock()
        }

        func abort() {
            lock.lock()
            let body = stop
            lock.unlock()
            body?()
        }

        func touch() {
            lock.lock()
            last = Date()
            lock.unlock()
        }

        var isDone: Bool {
            lock.lock()
            defer { lock.unlock() }
            return phase == .done
        }

        func enter(_ next: Phase) {
            lock.lock()
            phase = next
            last = Date()
            lock.unlock()
        }

        /// 進みが止まっていれば true（1 回だけ）。書き込み中は、サンプルが 60 秒進まないとき。
        /// 仕上げ（finishWriting。ファイルの並べ替えを含む）は、書き込みより時間がかかるので長めに待つ
        /// （10 分の高画質＝約 460 MB でも、並べ替えは数秒〜数十秒。遅い端末の余裕を見て 180 秒）
        func expired(finishLimit: TimeInterval) -> Bool {
            lock.lock()
            defer { lock.unlock() }
            guard !expiredFlag, phase != .done else { return false }
            let limit = phase == .writing ? 60 : finishLimit
            if Date().timeIntervalSince(last) > limit {
                expiredFlag = true
                return true
            }
            return false
        }
    }

    /// 結果を 1 回だけ返す（書き出しの完了と、見張りの時間切れが、どちらが先でも）
    private final class Once {
        private let lock = NSLock()
        private var settled = false
        func run(_ body: () -> Void) {
            lock.lock()
            defer { lock.unlock() }
            if settled { return }
            settled = true
            body()
        }
    }

    private static func fail(_ code: Int, _ message: String) -> NSError {
        NSError(domain: "lattecho", code: code, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private static func run(
        clips: [Clip], bgm: Bgm?, muteOriginal: Bool, outURL: URL, maxShortSide: CGFloat, videoBitrate: Int, audioBitrate: Int, queue: DispatchQueue,
        watchdog: Watchdog
    ) async throws -> [String: Any] {
        let timescale: CMTimeScale = 600
        let composition = AVMutableComposition()
        guard
            let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { throw fail(1, "映像の枠を作れません") }
        let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)

        // 区間ごとの映像の置き方（向き・大きさを、書き出す絵にそろえる）を、つなぎ終えてから作る
        struct Piece {
            let range: CMTimeRange
            let transform: CGAffineTransform
            /// 向きを直したあとの絵の大きさ
            let size: CGSize
            /// 向きを直したあとの絵の左上（preferredTransform で回すと原点がずれるので、戻すのに使う）
            let origin: CGPoint
        }
        var pieces: [Piece] = []
        var cursor = CMTime.zero
        var hasAudio = false

        for clip in clips {
            let asset = AVURLAsset(url: clip.url)
            guard let srcVideo = try await asset.loadTracks(withMediaType: .video).first else {
                throw fail(2, "映像がありません")
            }
            let total = try await asset.load(.duration)
            let startTime = CMTime(seconds: max(0, clip.start), preferredTimescale: timescale)
            let endTime = clip.end < 0 ? total : min(total, CMTime(seconds: clip.end, preferredTimescale: timescale))
            guard endTime > startTime else { throw fail(3, "切り取る範囲が空です") }
            let range = CMTimeRange(start: startTime, end: endTime)

            try videoTrack.insertTimeRange(range, of: srcVideo, at: cursor)
            // 音が無い動画（音なしで撮ったもの）は、その間を無音にする
            if !muteOriginal, let srcAudio = try await asset.loadTracks(withMediaType: .audio).first, let audioTrack {
                try audioTrack.insertTimeRange(range, of: srcAudio, at: cursor)
                hasAudio = true
            }
            let natural = try await srcVideo.load(.naturalSize)
            let preferred = try await srcVideo.load(.preferredTransform)
            let oriented = CGRect(origin: .zero, size: natural).applying(preferred)
            // 大きさが 0 の映像は、拡大の計算が無限大になる。最初の区間に限らず、どの区間でも断る
            guard oriented.width > 0, oriented.height > 0 else { throw fail(4, "映像の大きさが分かりません") }
            pieces.append(
                Piece(
                    range: CMTimeRange(start: cursor, duration: range.duration),
                    transform: preferred,
                    size: oriented.size,
                    origin: oriented.origin))
            cursor = cursor + range.duration
        }

        // BGM：動画の長さまで繰り返して並べる（長ければ、動画の終わりで切る）
        var bgmTrack: AVMutableCompositionTrack?
        var audioMix: AVMutableAudioMix?
        if let bgm {
            let asset = AVURLAsset(url: bgm.url)
            guard let source = try await asset.loadTracks(withMediaType: .audio).first else {
                throw fail(9, "BGM の音がありません")
            }
            let length = try await asset.load(.duration)
            guard length > .zero,
                let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
            else { throw fail(9, "BGM の長さが分かりません") }
            var at = CMTime.zero
            while at < cursor {
                let piece = min(length, cursor - at)
                try track.insertTimeRange(CMTimeRange(start: .zero, duration: piece), of: source, at: at)
                at = at + piece
            }
            // 音量は一定にし、終わりの 1.5 秒で 0 まで下げる（ぶつ切りで終わらないように）
            let params = AVMutableAudioMixInputParameters(track: track)
            params.setVolume(bgm.volume, at: .zero)
            let fade = min(CMTime(seconds: 1.5, preferredTimescale: timescale), cursor)
            params.setVolumeRamp(fromStartVolume: bgm.volume, toEndVolume: 0, timeRange: CMTimeRange(start: cursor - fade, duration: fade))
            let mix = AVMutableAudioMix()
            mix.inputParameters = [params]
            audioMix = mix
            bgmTrack = track
        }

        // 書き出す大きさ：最初の区間の向きと比に合わせ、短い辺を maxShortSide までにする（小さい動画は大きくしない）
        let first = pieces[0].size
        let scale = min(1, maxShortSide / min(first.width, first.height))
        let even = { (v: CGFloat) -> Int in max(2, Int((v * scale / 2).rounded()) * 2) }
        let width = even(first.width)
        let height = even(first.height)
        let renderSize = CGSize(width: width, height: height)

        // 区間ごとに、向きを直し、枠に収まるように（全体が見えるように）拡大・縮小して中央に置く
        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = renderSize
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
        // HDR（iPhone の標準のカメラ）は SDR（BT.709）に変換する（そのまま 8bit にすると、色が白っぽくなる）
        videoComposition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
        videoComposition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
        videoComposition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
        videoComposition.instructions = pieces.map { piece in
            let instruction = AVMutableVideoCompositionInstruction()
            instruction.timeRange = piece.range
            let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
            let fit = min(renderSize.width / piece.size.width, renderSize.height / piece.size.height)
            let dx = (renderSize.width - piece.size.width * fit) / 2
            let dy = (renderSize.height - piece.size.height * fit) / 2
            // 向きを直した絵の左上が原点になるよう、回した後の位置を戻してから拡大する
            let transform = piece.transform
                .concatenating(CGAffineTransform(translationX: -piece.origin.x, y: -piece.origin.y))
                .concatenating(CGAffineTransform(scaleX: fit, y: fit))
                .concatenating(CGAffineTransform(translationX: dx, y: dy))
            layer.setTransform(transform, at: piece.range.start)
            instruction.layerInstructions = [layer]
            return instruction
        }

        try? FileManager.default.removeItem(at: outURL)
        // 書き出し先のフォルダが無ければ作る（動画がすべてアプリのファイルにあるときは、一時の入力を書かないので、フォルダが無い。
        // Android は、書き出す前にフォルダを作っている）
        try FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let reader = try AVAssetReader(asset: composition)
        let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true

        let videoOut = AVAssetReaderVideoCompositionOutput(
            videoTracks: [videoTrack],
            videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
        videoOut.videoComposition = videoComposition
        videoOut.alwaysCopiesSampleData = false
        reader.add(videoOut)
        let videoIn = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
                AVVideoScalingModeKey: AVVideoScalingModeResizeAspectFill,
                AVVideoColorPropertiesKey: [
                    AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                    AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                    AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
                ],
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: videoBitrate,
                    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                ],
            ])
        videoIn.expectsMediaDataInRealTime = false
        writer.add(videoIn)

        var pairs: [(AVAssetReaderOutput, AVAssetWriterInput)] = [(videoOut, videoIn)]
        let audioTracks = [hasAudio ? audioTrack : nil, bgmTrack].compactMap { $0 }
        if !audioTracks.isEmpty {
            let audioOut = AVAssetReaderAudioMixOutput(
                audioTracks: audioTracks,
                audioSettings: [
                    AVFormatIDKey: kAudioFormatLinearPCM,
                    AVSampleRateKey: 44_100,
                    AVNumberOfChannelsKey: 2,
                    AVLinearPCMBitDepthKey: 16,
                    AVLinearPCMIsFloatKey: false,
                    AVLinearPCMIsBigEndianKey: false,
                    AVLinearPCMIsNonInterleaved: false,
                ])
            audioOut.audioMix = audioMix
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

        // 進みが止まったら、まず読み込みをやめさせる（コマの取り出しが戻り、書き込みの輪が終わる）。仕上げで止まったら、書き出しをやめる
        watchdog.setAbort { [weak reader, weak writer] in
            reader?.cancelReading()
            if writer?.status == .writing { writer?.cancelWriting() }
        }
        // 準備（動画の読み込み・つなぎ）にかかった時間を、「進まない」に数えない。ここから数え直す
        watchdog.enter(.writing)
        guard reader.startReading() else { throw reader.error ?? fail(5, "読み込みを始められません") }
        guard writer.startWriting() else { throw writer.error ?? fail(6, "書き出しを始められません") }
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
                                    watchdog.touch()
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

        if watchdog.timedOut {
            // 読み込みをやめさせたので、書けた分は途中まで。できあがりとして返さない
            writer.cancelWriting()
            throw fail(10, "進まなくなったので止めました")
        }
        if reader.status == .failed {
            writer.cancelWriting()
            throw reader.error ?? fail(7, "読み込みに失敗しました")
        }
        watchdog.enter(.finishing)
        await writer.finishWriting()
        if watchdog.timedOut { throw fail(10, "進まなくなったので止めました") }
        if writer.status != .completed { throw writer.error ?? fail(8, "書き出しに失敗しました") }

        let size = (try? FileManager.default.attributesOfItem(atPath: outURL.path)[.size] as? Int) ?? 0
        return ["size": size, "width": width, "height": height, "duration": cursor.seconds]
    }
}
