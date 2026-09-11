package com.bpp.cocktailflashcards;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Points the home screen icon at whichever colour scheme the app is wearing.
 *
 * Android does not let an app change its icon. What it allows is several
 * launcher entries with different icons and one of them enabled: an
 * {@code <activity-alias>} per scheme in AndroidManifest.xml, all pointing at
 * CocktailActivity, flipped through PackageManager. That is the whole mechanism,
 * and it is why the scheme list exists three times — the palettes in
 * scripts/icons.mjs, the aliases in the manifest, and {@link Scheme} here.
 *
 * The JavaScript side is src/launcher-icon.js, called from the theme effect in
 * src/App.jsx.
 */
@CapacitorPlugin(name = "LauncherIcon")
public class LauncherIconPlugin extends Plugin {

    /**
     * One entry per scheme in THEMES (src/App.jsx), by that scheme's id.
     *
     * {@code enabledInManifest} mirrors the alias's {@code android:enabled}, and
     * is needed because PackageManager answers COMPONENT_ENABLED_STATE_DEFAULT —
     * "whatever the manifest said" — rather than a boolean, for every component
     * nothing has explicitly set. On a fresh install that is all of them.
     */
    private enum Scheme {
        RETRO("retro", ".MainActivity", true),
        FUTURE("future", ".FutureLauncher", false);

        final String id;
        final String alias;
        final boolean enabledInManifest;

        Scheme(String id, String alias, boolean enabledInManifest) {
            this.id = id;
            this.alias = alias;
            this.enabledInManifest = enabledInManifest;
        }

        static Scheme byId(String id) {
            for (Scheme scheme : values()) {
                if (scheme.id.equals(id)) return scheme;
            }
            return null;
        }
    }

    private static final String TAG = "LauncherIcon";
    private static final String PREFS = "launcher_icon";
    private static final String KEY_PENDING = "pending_scheme";

    /**
     * Record which icon the app should be wearing. The swap itself waits for
     * {@link #handleOnPause()}.
     */
    @PluginMethod
    public void set(PluginCall call) {
        String id = call.getString("scheme");
        Scheme wanted = id == null ? null : Scheme.byId(id);
        if (wanted == null) {
            // Not silent: a scheme added to THEMES and forgotten here would
            // otherwise just quietly never reach the home screen.
            call.reject("No launcher icon for colour scheme: " + id);
            return;
        }

        boolean pending = wanted != live();
        SharedPreferences.Editor edit = prefs().edit();
        if (pending) {
            edit.putString(KEY_PENDING, wanted.id);
        } else {
            // Switched away and back again before the app was ever backgrounded.
            edit.remove(KEY_PENDING);
        }
        edit.apply();

        JSObject result = new JSObject();
        result.put("scheme", wanted.id);
        result.put("pending", pending);
        call.resolve(result);
    }

    /** What the home screen is showing now, and whether a swap is queued. */
    @PluginMethod
    public void get(PluginCall call) {
        JSObject result = new JSObject();
        result.put("scheme", live().id);
        result.put("pending", prefs().getString(KEY_PENDING, null));
        call.resolve(result);
    }

    /**
     * The swap happens as the app leaves the foreground, not when JavaScript
     * asks for it, for two reasons.
     *
     * Changing a component's enabled state while its own task is in front is the
     * case that misbehaves: depending on the launcher and the Android version it
     * can drop the task out of Recents or bounce the user to the home screen
     * mid-session. This app is a WebView on a live site, so that costs the user
     * their place in a quiz rather than a redraw.
     *
     * And the icon cannot be seen from inside the app in any case. onPause is
     * the last moment before the launcher is on screen, which is exactly when it
     * has to be right.
     */
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        applyPending();
    }

    private void applyPending() {
        String id = prefs().getString(KEY_PENDING, null);
        if (id == null) return;
        prefs().edit().remove(KEY_PENDING).apply();

        Scheme wanted = Scheme.byId(id);
        if (wanted == null || wanted == live()) return;

        try {
            PackageManager pm = getContext().getPackageManager();
            // Enable the new entry BEFORE disabling the old one. Between the two
            // calls the launcher sees whatever is enabled at that instant, and a
            // package with no enabled LAUNCHER component is, to a launcher, an
            // uninstalled one — a redraw landing in that window can drop the app
            // out of the drawer and off the home screen, and it does not
            // necessarily come back.
            //
            // DONT_KILL_APP on both: without it the process is killed the moment
            // the component changes, which is the swap taking the app down with
            // it.
            pm.setComponentEnabledSetting(
                component(wanted),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
            );
            for (Scheme other : Scheme.values()) {
                if (other == wanted) continue;
                pm.setComponentEnabledSetting(
                    component(other),
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
                );
            }
            Logger.debug(TAG, "Launcher icon now " + wanted.id);
        } catch (Exception e) {
            // A cosmetic feature is not worth a crash on the way out of the app.
            Logger.error(TAG, "Could not swap the launcher icon", e);
        }
    }

    /** The scheme whose alias is currently the enabled launcher entry. */
    private Scheme live() {
        try {
            PackageManager pm = getContext().getPackageManager();
            for (Scheme scheme : Scheme.values()) {
                int state = pm.getComponentEnabledSetting(component(scheme));
                if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return scheme;
                if (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && scheme.enabledInManifest) {
                    return scheme;
                }
            }
        } catch (Exception e) {
            Logger.error(TAG, "Could not read the launcher icon state", e);
        }
        // Nothing enabled at all should not be reachable — the enable happens
        // before the disable — but the answer that keeps the app askable is the
        // manifest default rather than an exception.
        return Scheme.RETRO;
    }

    /**
     * The alias names are written relative to the namespace package, which is
     * where this class lives; the ComponentName's package is the applicationId,
     * which is what getPackageName() returns. The two are the same string in
     * android/app/build.gradle, but they are different things, so they are
     * resolved separately.
     */
    private ComponentName component(Scheme scheme) {
        return new ComponentName(
            getContext(),
            LauncherIconPlugin.class.getPackage().getName() + scheme.alias
        );
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
