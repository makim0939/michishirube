package me.makimura.lattecho;

import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.common.audio.DefaultGainProvider;
import androidx.media3.common.audio.GainProcessor;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultEncoderFactory;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.Transformer;
import androidx.media3.transformer.VideoEncoderSettings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.collect.ImmutableList;
import com.google.common.collect.ImmutableSet;
import java.io.File;
import org.json.JSONObject;

/**
 * 複数の動画から、指定した区間を切り出し、順につないで 1 本の MP4（H.264・AAC）にする。
 * 切り取りもこれで行う（1 本・1 区間のつなぎ）。
 * 場所は、アプリのファイル（Filesystem の Directory.Data）からの相対パスで受け取る。
 * 区間のつなぎ目はカットのみ（Media3 のクロスフェードは未対応）
 */
@UnstableApi
@CapacitorPlugin(name = "VideoComposer")
public class VideoComposerPlugin extends Plugin {

    @PluginMethod
    public void compose(PluginCall call) {
        JSArray clips = call.getArray("clips");
        String output = call.getString("output");
        if (clips == null || clips.length() == 0 || output == null) {
            call.reject("clips と output が要ります");
            return;
        }
        int maxShortSide = call.getInt("maxShortSide", 720);
        int videoBitrate = call.getInt("videoBitrate", 1_200_000);
        File dir = getContext().getFilesDir();
        File out = new File(dir, output);

        // 小さい動画を大きくはしない（iOS と同じ。大きさは最初の区間を基準にする）
        int targetShortSide = maxShortSide;
        ImmutableList.Builder<EditedMediaItem> items = new ImmutableList.Builder<>();
        try {
            for (int i = 0; i < clips.length(); i++) {
                JSONObject clip = clips.getJSONObject(i);
                File in = new File(dir, clip.getString("input"));
                if (i == 0) targetShortSide = Math.min(maxShortSide, shortSideOf(in, maxShortSide));
                double start = clip.optDouble("start", 0);
                // end が無ければ、動画の終わりまで
                double end = clip.optDouble("end", -1);
                MediaItem.ClippingConfiguration.Builder clipping = new MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionMs(Math.max(0, Math.round(start * 1000)));
                if (end >= 0) {
                    if (end <= start) {
                        call.reject("切り取る範囲が空です");
                        return;
                    }
                    clipping.setEndPositionMs(Math.round(end * 1000));
                }
                MediaItem mediaItem = new MediaItem.Builder()
                    .setUri(Uri.fromFile(in))
                    .setClippingConfiguration(clipping.build())
                    .build();
                items.add(new EditedMediaItem.Builder(mediaItem).build());
            }
        } catch (Exception e) {
            call.reject("clips が読めません: " + e.getMessage(), e);
            return;
        }

        // BGM（任意）：入力のファイルと音量（0〜1）。動画の長さまで繰り返し、終わりの 1.5 秒で小さくしていく
        JSObject bgm = call.getObject("bgm");
        File bgmFile = null;
        float bgmVolume = 0.3f;
        double bgmTotalSeconds = 0;
        if (bgm != null && bgm.optString("input", null) != null) {
            bgmFile = new File(dir, bgm.optString("input"));
            bgmVolume = (float) Math.max(0, Math.min(1, bgm.optDouble("volume", 0.3)));
            bgmTotalSeconds = bgm.optDouble("totalSeconds", 0);
        }
        final File bgmInput = bgmFile;
        final float bgmGain = bgmVolume;
        final double totalSeconds = bgmTotalSeconds;

        final int shortSide = targetShortSide;
        //noinspection ResultOfMethodCallIgnored
        out.delete();
        File parent = out.getParentFile();
        if (parent != null) //noinspection ResultOfMethodCallIgnored
            parent.mkdirs();

        // Transformer は Looper のあるスレッドで動かす
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                Transformer transformer = new Transformer.Builder(getContext())
                    .setVideoMimeType(MimeTypes.VIDEO_H264)
                    .setAudioMimeType(MimeTypes.AUDIO_AAC)
                    .setEncoderFactory(
                        new DefaultEncoderFactory.Builder(getContext())
                            .setRequestedVideoEncoderSettings(new VideoEncoderSettings.Builder().setBitrate(videoBitrate).build())
                            .build()
                    )
                    .addListener(
                        new Transformer.Listener() {
                            @Override
                            public void onCompleted(Composition composition, ExportResult exportResult) {
                                JSObject result = new JSObject();
                                result.put("size", out.length());
                                result.put("duration", exportResult.durationMs / 1000.0);
                                call.resolve(result);
                            }

                            @Override
                            public void onError(Composition composition, ExportResult exportResult, ExportException exportException) {
                                //noinspection ResultOfMethodCallIgnored
                                out.delete();
                                call.reject("動画をつなげませんでした: " + exportException.getMessage(), exportException);
                            }
                        }
                    )
                    .build();
                // 音が無い動画（音なしで撮ったもの）があっても、つないだ音が途切れないよう、音の枠を必ず作る
                EditedMediaItemSequence sequence = new EditedMediaItemSequence.Builder(items.build())
                    .experimentalSetForceAudioTrack(true)
                    .build();
                ImmutableList.Builder<EditedMediaItemSequence> sequences = new ImmutableList.Builder<>();
                sequences.add(sequence);
                if (bgmInput != null) {
                    DefaultGainProvider.Builder gain = new DefaultGainProvider.Builder(bgmGain);
                    long fadeUs = 1_500_000L;
                    long startUs = Math.round(totalSeconds * 1_000_000L) - fadeUs;
                    if (totalSeconds > 0 && startUs > 0) gain.addFadeAt(startUs, fadeUs, DefaultGainProvider.FADE_OUT_LINEAR);
                    EditedMediaItem bgmItem = new EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(bgmInput)))
                        .setRemoveVideo(true)
                        .setEffects(new Effects(ImmutableList.of(new GainProcessor(gain.build())), ImmutableList.of()))
                        .build();
                    // 動画の長さまで繰り返す（繰り返す列は、ほかの列が終わるまで続く）
                    sequences.add(
                        new EditedMediaItemSequence.Builder(ImmutableSet.of(C.TRACK_TYPE_AUDIO)).addItem(bgmItem).setIsLooping(true).build()
                    );
                }
                // 大きさは、つないだ全体でそろえる（区間ごとに向き・大きさが違っても、枠に収める）
                Composition composition = new Composition.Builder(sequences.build())
                    .setEffects(new Effects(ImmutableList.of(), ImmutableList.of(Presentation.createForShortSide(shortSide))))
                    // HDR（標準のカメラの 10bit 動画）は、SDR に変換する（H.264 の HDR を作れない端末が多いため）
                    .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
                    .build();
                transformer.start(composition, out.getAbsolutePath());
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                out.delete();
                call.reject("動画をつなげませんでした: " + e.getMessage(), e);
            }
        });
    }

    /** 動画の短い辺（向きに関わらず同じ）。読めなければ fallback */
    private static int shortSideOf(File file, int fallback) {
        MediaMetadataRetriever probe = new MediaMetadataRetriever();
        try {
            probe.setDataSource(file.getAbsolutePath());
            int width = parse(probe.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
            int height = parse(probe.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
            int side = Math.min(width, height);
            return side > 0 ? side : fallback;
        } catch (Exception e) {
            return fallback;
        } finally {
            try {
                probe.release();
            } catch (Exception ignored) {
            }
        }
    }

    private static int parse(String value) {
        try {
            return value == null ? 0 : Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
