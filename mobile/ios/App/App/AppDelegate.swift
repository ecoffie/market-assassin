import UIKit
import WebKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// iOS 27 refuses to launch apps built with its SDK unless they use the UIScene
// life cycle. The scene builds the window from Main.storyboard (the Capacitor
// web view) and forwards opened links to Capacitor, as the app delegate did.
// It lives in this file so the Xcode project needs no new file reference.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard scene is UIWindowScene else { return }
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}

// The phone app is NOT the website: it shows the sign-in + two tabs at /app/phone
// and the Opportunity Map. Any other page (pricing, forgot password, blog, other
// sites) opens in Safari. Main.storyboard points at this controller so the guard
// is registered before the first page loads.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PhoneNavPlugin())
    }
}

@objc(PhoneNavPlugin)
public class PhoneNavPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhoneNavPlugin"
    public let jsName = "PhoneNav"
    public let pluginMethods: [CAPPluginMethod] = []

    static let appHosts: Set<String> = ["getmindy.ai", "www.getmindy.ai"]
    static let appPaths = ["/app/phone", "/opportunity-map"]

    /// The host the app was started on (capacitor.config.ts server.url) also counts,
    /// so a test build pointed at a preview address works the same way.
    static func staysInApp(_ url: URL, serverHost: String? = nil) -> Bool {
        guard let host = url.host?.lowercased(),
              appHosts.contains(host) || host == serverHost?.lowercased() else { return false }
        let path = url.path.isEmpty ? "/" : url.path
        return appPaths.contains { path == $0 || path.hasPrefix($0 + "/") }
    }

    // nil = let Capacitor decide (allow), true = cancel the load.
    override public func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url,
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
        let newWindow = navigationAction.targetFrame == nil
        let mainFrame = navigationAction.targetFrame?.isMainFrame == true
        // Inside the map iframe only a link the person TAPPED counts; background
        // frames (analytics, embeds) must never pop Safari.
        if !newWindow && !mainFrame && navigationAction.navigationType != .linkActivated { return nil }
        if !newWindow && PhoneNavPlugin.staysInApp(url, serverHost: bridge?.config.serverURL.host) { return nil }
        DispatchQueue.main.async { UIApplication.shared.open(url, options: [:], completionHandler: nil) }
        return true
    }
}
