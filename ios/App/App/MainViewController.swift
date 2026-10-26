import Capacitor
import UIKit
import WebKit

/// アプリの画面。アプリの中だけのプラグイン（動画の画質をそろえる・Sign in with Apple）を登録する
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VideoTranscoderPlugin())
        bridge?.registerPluginInstance(VideoComposerPlugin())
        bridge?.registerPluginInstance(SignInWithApplePlugin())
        passAppLanguage()
    }

    /// アプリが動いている言語（ja・en）を、ページを読む前に画面へ渡す（src/i18n）。
    /// iPhone の設定でアプリごとに選んだ言語は、WebView の navigator.language に出ないことがあるため、
    /// アプリ名や許可の文と同じく、アプリの言語（InfoPlist.strings のある言語から iOS が選んだもの）に合わせる
    private func passAppLanguage() {
        let language = Bundle.main.preferredLocalizations.first == "ja" ? "ja" : "en"
        let script = WKUserScript(
            source: "window.__APP_LANGUAGE__ = '\(language)';",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        webView?.configuration.userContentController.addUserScript(script)
    }
}
