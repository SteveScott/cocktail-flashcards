package com.bpp.cocktailflashcards;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * The app's only activity — the Capacitor bridge, and nothing else.
 *
 * It is deliberately NOT called MainActivity any more. That name now belongs to
 * an {@code <activity-alias>} in AndroidManifest.xml: the launcher entries are
 * aliases, one per colour scheme, so the icon can follow the scheme the app is
 * wearing, and a home screen icon records the component it was dragged from.
 * Every install out there recorded com.bpp.cocktailflashcards.MainActivity, so
 * the default alias keeps that name and this class took a new one. See the
 * manifest and LauncherIconPlugin.
 *
 * It is also what every launcher shortcut is aimed at, and that is not a free
 * choice. A shortcut's intent names a component, and the two aliases are
 * switched on and off as the colour scheme changes — a shortcut pointed at one
 * of them would stop launching the moment the user picked the other scheme,
 * including for shortcuts already pinned to a home screen. This class is
 * enabled always. See ShortcutRoutes and res/xml/shortcuts.xml.
 */
public class CocktailActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate, which is when the bridge collects its plugins.
        // Plugins from npm packages register themselves through the generated
        // capacitor.plugins.json; one living in this project has to say so here.
        registerPlugin(LauncherIconPlugin.class);
        registerPlugin(AppShortcutPlugin.class);
        registerPlugin(AppReleasePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
