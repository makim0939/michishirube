import Capacitor
import UIKit

/// アプリの画面。アプリの中だけのプラグイン（動画の画質をそろえる・Sign in with Apple）を登録する
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VideoTranscoderPlugin())
        bridge?.registerPluginInstance(SignInWithApplePlugin())
    }
}
