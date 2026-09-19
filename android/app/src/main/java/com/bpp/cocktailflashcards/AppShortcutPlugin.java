package com.bpp.cocktailflashcards;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hands the web app whichever launcher shortcut opened it.
 *
 * Long-pressing the home screen icon lists Study, Self Quiz and 86 It
 * (res/xml/shortcuts.xml). Each is an explicit intent at CocktailActivity
 * carrying {@code cocktailflashcards://shortcut/<id>}; this plugin is the only
 * thing that reads it, and {@link ShortcutRoutes} is the only thing that parses
 * it.
 *
 * <p>Two ways in, because a shortcut can be tapped in two quite different states
 * and they arrive by different routes:
 *
 * <ul>
 *   <li><b>Cold start</b> — the shortcut is on the intent that created the
 *       activity, and it is there before any JavaScript exists. It waits in
 *       {@link #pending} for {@link #consume} to come and get it.</li>
 *   <li><b>Already running</b> — {@code launchMode="singleTop"} means no second
 *       activity; the intent arrives at {@link #handleOnNewIntent} instead, and
 *       is announced as a {@code shortcut} event.</li>
 * </ul>
 *
 * <p>The pull is what makes the cold start reliable. The shell loads the
 * deployed site over the network (capacitor.config.json → server.url), so there
 * is no bound on how long the page takes to parse, let alone to register a
 * listener; an event fired at activity creation would have nobody listening. So
 * the launch intent is never fired — it is stored, and handed over on request,
 * however late the request comes.
 *
 * <p>The JavaScript end is src/app-shortcuts.js.
 */
@CapacitorPlugin(name = "AppShortcut")
public class AppShortcutPlugin extends Plugin {

    private static final String TAG = "AppShortcut";
    private static final String EVENT = "shortcut";

    /**
     * The shortcut that started the app and has not been collected yet.
     *
     * <p>Read from the launch intent in {@link #load()} rather than inside
     * {@link #consume}, because by the time JavaScript asks, the intent may no
     * longer say so: Capacitor's own deep-link handling and the return from
     * Google sign-in both hand the activity a replacement intent. Take it once,
     * at the only moment it is certainly still there.
     */
    private String pending;

    @Override
    public void load() {
        super.load();
        pending = idOf(getActivity() == null ? null : getActivity().getIntent());
        if (pending != null) Logger.debug(TAG, "Launched by shortcut: " + pending);
    }

    /**
     * The shortcut this launch came from, once.
     *
     * <p>Once is the contract: a shortcut is an instruction to go somewhere, and
     * the app is entitled to be navigated away from there afterwards. Were this
     * to keep answering, every later caller — a reload of the site, a remount of
     * the React tree, the return from the browser that ran sign-in — would read
     * the same answer and throw the user back into a quiz they had already left.
     *
     * <p>Resolves with {@code shortcut} absent when there is nothing to collect,
     * which is the overwhelming majority of launches. src/app-shortcuts.js reads
     * that as undefined and does nothing, which is what an ordinary tap on the
     * icon should do.
     */
    @PluginMethod
    public void consume(PluginCall call) {
        JSObject result = new JSObject();
        result.put("shortcut", pending);
        pending = null;
        call.resolve(result);
    }

    /**
     * A shortcut tapped while the app is already open.
     *
     * <p>There is a listener by now, by definition — the app is running — so
     * this one is pushed rather than stored. It is still recorded in
     * {@link #pending} first, for the case where the page happens to be
     * reloading at this instant and the event lands on nobody.
     */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String id = idOf(intent);
        if (id == null) return;

        Logger.debug(TAG, "Shortcut while running: " + id);
        pending = id;

        JSObject data = new JSObject();
        data.put("shortcut", id);
        notifyListeners(EVENT, data);
    }

    /**
     * The shortcut id on an intent, or null.
     *
     * <p>{@code getDataString()} rather than {@code getData()}: the id is a
     * string question, ShortcutRoutes answers it as one, and this keeps
     * {@code android.net.Uri} out of the parse. Uri is a stub on the JVM — its
     * methods throw rather than parse — so a ShortcutRoutes that touched it
     * could only be tested on a device, and that is the part with the edge
     * cases. The catch is only to keep a malformed intent from being a crash on
     * the way up.
     */
    private String idOf(Intent intent) {
        if (intent == null) return null;
        try {
            return ShortcutRoutes.idFor(intent.getDataString());
        } catch (Exception e) {
            Logger.error(TAG, "Could not read the launch intent", e);
            return null;
        }
    }
}
