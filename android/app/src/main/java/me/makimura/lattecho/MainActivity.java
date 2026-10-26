package me.makimura.lattecho;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // アプリの中だけのプラグイン（動画の画質をそろえる・つなぐ）
        registerPlugin(VideoTranscoderPlugin.class);
        registerPlugin(VideoComposerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
