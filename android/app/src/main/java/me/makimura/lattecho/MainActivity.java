package me.makimura.lattecho;

import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.media3.common.util.UnstableApi;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

// 自分のプラグイン（Media3 の不安定な API を使う）を登録するので、lint の opt-in の検査を満たすために付ける
@UnstableApi
public class MainActivity extends BridgeActivity {

    /** 続けて作り直さない間隔（ms）。起動の直後に毎回落ちるときに、作り直しを繰り返して止まらなくなるのを防ぐ */
    private static final long RECREATE_MIN_INTERVAL_MS = 3000;
    private static long lastRecreateAt = -RECREATE_MIN_INTERVAL_MS;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // アプリの中だけのプラグイン（動画の画質をそろえる・つなぐ）
        registerPlugin(VideoTranscoderPlugin.class);
        registerPlugin(VideoComposerPlugin.class);
        super.onCreate(savedInstanceState);

        // WebView の描画のプロセスが落ちた（大きな動画でメモリが足りなくなるなど）とき、true を返さないと、アプリごと終了する
        // （Capacitor の既定は false。iPhone は Capacitor が自動で読み込み直す）。作り直して、画面を最初から読み込む
        getBridge().addWebViewListener(
            new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    Log.w("MainActivity", "WebView の描画プロセスが終了");
                    long now = SystemClock.elapsedRealtime();
                    if (now - lastRecreateAt >= RECREATE_MIN_INTERVAL_MS) {
                        lastRecreateAt = now;
                        runOnUiThread(MainActivity.this::recreate);
                    }
                    return true;
                }
            }
        );
    }
}
