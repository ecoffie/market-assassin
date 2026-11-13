package ai.getmindy.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Keeps the app on the phone screen + map; other links open in the browser.
        registerPlugin(PhoneNavPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
