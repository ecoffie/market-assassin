package ai.getmindy.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Arrays;
import java.util.List;

/**
 * The phone app is NOT the website: it shows the sign-in + two tabs at /app/phone
 * and the Opportunity Map. Any other page (pricing, forgot password, blog, other
 * sites) opens in the phone's browser. Same rule as PhoneNavPlugin in the iOS
 * AppDelegate.swift.
 */
@CapacitorPlugin(name = "PhoneNav")
public class PhoneNavPlugin extends Plugin {

    private static final List<String> APP_HOSTS = Arrays.asList("getmindy.ai", "www.getmindy.ai");
    private static final List<String> APP_PATHS = Arrays.asList("/app/phone", "/opportunity-map");

    /** The host the app was started on (capacitor.config.ts server.url) also counts,
     *  so a test build pointed at a preview address works the same way. */
    static boolean staysInApp(Uri url, String serverHost) {
        String host = url.getHost();
        if (host == null) return false;
        host = host.toLowerCase();
        if (!APP_HOSTS.contains(host) && !host.equalsIgnoreCase(serverHost)) return false;
        String path = url.getPath() == null || url.getPath().isEmpty() ? "/" : url.getPath();
        for (String p : APP_PATHS) {
            if (path.equals(p) || path.startsWith(p + "/")) return true;
        }
        return false;
    }

    // null = let Capacitor decide (allow), true = this plugin handled it (cancel the load).
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String scheme = url.getScheme();
        if (scheme == null || !(scheme.equals("http") || scheme.equals("https"))) return null;
        String server = getBridge().getServerUrl();
        String serverHost = server == null ? null : Uri.parse(server).getHost();
        if (staysInApp(url, serverHost)) return null;
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException ignored) {
            // No browser installed: stay put rather than load the page inside the app.
        }
        return true;
    }
}
