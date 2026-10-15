package io.github.makim0939.lattecho;

import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultEncoderFactory;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.Transformer;
import androidx.media3.transformer.VideoEncoderSettings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.collect.ImmutableList;
import java.io.File;

/**
 * 動画を、決めた画質（短い辺の画素数・ビットレート）の MP4（H.264・AAC）に作り直す。
 * アルバム・標準のカメラの大きな動画や、日がたった高画質の動画を軽くするのに使う。
 * 場所は、アプリのファイル（Filesystem の Directory.Data）からの相対パスで受け取る
 */
@UnstableApi
@CapacitorPlugin(name = "VideoTranscoder")
public class VideoTranscoderPlugin extends Plugin {

    @PluginMethod
    public void transcode(PluginCall call) {
        String input = call.getString("input");
        String output = call.getString("output");
        if (input == null || output == null) {
            call.reject("input と output が要ります");
            return;
        }
        int maxShortSide = call.getInt("maxShortSide", 720);
        int videoBitrate = call.getInt("videoBitrate", 1_200_000);
        int audioBitrate = call.getInt("audioBitrate", 96_000);
        File dir = getContext().getFilesDir();
        File in = new File(dir, input);
        File out = new File(dir, output);

        // すでに決めた画質以下なら、作り直さない（画質を落とすだけになるので）
        int shortSide = 0;
        MediaMetadataRetriever probe = new MediaMetadataRetriever();
        try {
            probe.setDataSource(in.getAbsolutePath());
            int width = parse(probe.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
            int height = parse(probe.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
            long bitrate = parse(probe.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE));
            // WebM などでは書かれていないので、大きさと長さから求める
            long durationMs = parse(probe.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            if (bitrate <= 0 && durationMs > 0) bitrate = in.length() * 8 * 1000 / durationMs;
            shortSide = Math.min(width, height);
            if (shortSide > 0 && shortSide <= maxShortSide * 1.05 && bitrate > 0 && bitrate <= (videoBitrate + audioBitrate) * 1.3) {
                JSObject result = new JSObject();
                result.put("skipped", true);
                call.resolve(result);
                return;
            }
        } catch (Exception e) {
            // 読めなければ、作り直してみる
        } finally {
            try {
                probe.release();
            } catch (Exception ignored) {
            }
        }

        // 小さい動画を大きくはしない
        int targetShortSide = shortSide > 0 ? Math.min(maxShortSide, shortSide) : maxShortSide;
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
                                result.put("skipped", false);
                                result.put("size", out.length());
                                call.resolve(result);
                            }

                            @Override
                            public void onError(Composition composition, ExportResult exportResult, ExportException exportException) {
                                //noinspection ResultOfMethodCallIgnored
                                out.delete();
                                call.reject("動画を作り直せませんでした: " + exportException.getMessage(), exportException);
                            }
                        }
                    )
                    .build();
                EditedMediaItem item = new EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(in)))
                    .setEffects(new Effects(ImmutableList.of(), ImmutableList.of(Presentation.createForShortSide(targetShortSide))))
                    .build();
                transformer.start(item, out.getAbsolutePath());
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                out.delete();
                call.reject("動画を作り直せませんでした: " + e.getMessage(), e);
            }
        });
    }

    private static int parse(String value) {
        try {
            return value == null ? 0 : Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
