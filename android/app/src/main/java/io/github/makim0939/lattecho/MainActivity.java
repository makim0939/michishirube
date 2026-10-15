package io.github.makim0939.lattecho;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // アプリの中だけのプラグイン（動画の画質をそろえる）
        registerPlugin(VideoTranscoderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
