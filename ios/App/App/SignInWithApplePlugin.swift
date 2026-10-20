import AuthenticationServices
import Capacitor
import Foundation

/// Sign in with Apple の画面を出して、ID トークンを受け取る（アプリの中だけのプラグイン）。
/// 外部のプラグインは Capacitor 8 に対応していないため、ここに書いている（動画の画質をそろえるプラグインと同じ作り）。
/// 結果は、アプリ側の account.ts が受け取る形（response の中に identityToken と email）にそろえる
@objc(SignInWithApplePlugin)
public class SignInWithApplePlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "SignInWithApplePlugin"
    public let jsName = "SignInWithApple"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    /// 認可の画面が閉じるまで、呼び出し元と認可の処理を保つ（途中で消えると、結果を返せない）
    private var pending: CAPPluginCall?
    private var controller: ASAuthorizationController?

    @objc func authorize(_ call: CAPPluginCall) {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        // 名前とメールだけを求める（広告には使わない。メールを隠す選択もできる）
        request.requestedScopes = [.fullName, .email]
        // nonce は、アプリが作った値の SHA-256。サーバーが元の値と照らし合わせる
        if let nonce = call.getString("nonce") {
            request.nonce = nonce
        }
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        pending = call
        self.controller = controller
        bridge?.saveCall(call)
        controller.performRequests()
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        bridge?.webView?.window ?? UIWindow()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = pending else { return }
        finish()
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8)
        else {
            call.reject("Apple からトークンを受け取れませんでした")
            return
        }
        // 辞書は、型を明示して段階ごとに作る（一度に書くと、コンパイラが型を決められないため）
        var response: [String: Any] = [
            "user": credential.user,
            "identityToken": identityToken,
        ]
        response["email"] = credential.email ?? NSNull()
        response["givenName"] = credential.fullName?.givenName ?? NSNull()
        response["familyName"] = credential.fullName?.familyName ?? NSNull()
        if let code = credential.authorizationCode, let text = String(data: code, encoding: .utf8) {
            response["authorizationCode"] = text
        }
        call.resolve(["response": response])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = pending else { return }
        finish()
        // 取り消しは、番号 1001（ASAuthorizationError.canceled）。アプリ側で、エラーにしないために使う
        let code = (error as NSError).code
        call.reject("Apple の認証でエラー（\(code)）: \(error.localizedDescription)", String(code))
    }

    private func finish() {
        if let call = pending {
            bridge?.releaseCall(call)
        }
        pending = nil
        controller = nil
    }
}
