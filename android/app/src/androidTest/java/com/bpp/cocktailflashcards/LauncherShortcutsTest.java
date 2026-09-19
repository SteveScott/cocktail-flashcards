package com.bpp.cocktailflashcards;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.net.Uri;
import android.os.Build;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Run with: {@code ./gradlew :app:connectedDebugAndroidTest} from android/, with
 * a device or emulator attached.
 *
 * ShortcutRoutesTest covers the parsing on the JVM. This covers the half that
 * only exists once the app is installed: whether the system actually published
 * the three shortcuts, and whether what they point at can be launched. Both are
 * things that fail silently — a shortcut with a bad component does not warn at
 * build time, it just does nothing when someone taps it, and the only way to
 * find out is to ask a real PackageManager.
 */
@RunWith(AndroidJUnit4.class)
public class LauncherShortcutsTest {

    private Context context() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    /**
     * The applicationId, which build.gradle sets and the manifest's
     * ${applicationId} placeholders resolve against. It is worth one assertion
     * because the FileProvider authority and the Play listing are both built
     * from it.
     */
    @Test
    public void theAppIsTheOneUnderTest() {
        assertEquals("com.bpp.cocktailflashcards", context().getPackageName());
    }

    /** Android ignores res/xml/shortcuts entirely below API 25. */
    private ShortcutManager shortcuts() {
        Assume.assumeTrue(
            "ShortcutManager arrived in API 25; minSdk here is 24",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1
        );
        ShortcutManager manager = context().getSystemService(ShortcutManager.class);
        assertNotNull("no ShortcutManager on an API 25+ device", manager);
        return manager;
    }

    @Test
    public void publishesEveryShortcutInTheRouteTable() {
        List<String> published = new ArrayList<>();
        for (ShortcutInfo info : shortcuts().getManifestShortcuts()) {
            published.add(info.getId());
        }
        // Sorted both sides: getManifestShortcuts() documents no order, and the
        // order that does matter — the one the menu is listed in — is the order
        // of res/xml/shortcuts.xml, which tests/app-shortcuts.test.mjs pins.
        List<String> expected = new ArrayList<>(Arrays.asList(ShortcutRoutes.ids()));
        Collections.sort(expected);
        Collections.sort(published);
        assertEquals(
            "res/xml/shortcuts.xml and ShortcutRoutes disagree",
            expected,
            published
        );
    }

    @Test
    public void everyPublishedShortcutIsEnabledAndLabelled() {
        for (ShortcutInfo info : shortcuts().getManifestShortcuts()) {
            assertTrue(info.getId() + " is published but disabled", info.isEnabled());

            CharSequence shortLabel = info.getShortLabel();
            assertNotNull(info.getId() + " has no short label", shortLabel);
            assertTrue(info.getId() + " has an empty short label", shortLabel.length() > 0);

            // The launcher truncates rather than wraps, so a long one is not a
            // cosmetic problem — it is a menu entry nobody can read. Android's
            // own guidance is about ten characters.
            assertTrue(
                info.getId() + " short label is too long for the menu: " + shortLabel,
                shortLabel.length() <= 12
            );
        }
    }

    /**
     * The component half of the contract.
     *
     * The launcher entries are activity-aliases and exactly one is enabled at a
     * time — LauncherIconPlugin flips them with the colour scheme. A shortcut
     * aimed at an alias therefore works until the user changes scheme and then
     * stops, including for a copy already pinned to the home screen. Resolving
     * the intent here is what catches that: an intent at a disabled component
     * resolves to nothing.
     *
     * <p>Note what this does NOT check: that the shortcut Android actually
     * published carries that URI. The intent below is built from ShortcutRoutes
     * rather than read back, because {@code ShortcutInfo.getIntent()} answers
     * null to anyone who is not the launcher. An android:data missing from
     * res/xml/shortcuts.xml fails tests/app-shortcuts.test.mjs, which reads the
     * file as text — but one present in the file and not reaching the intent
     * passes everything here and then opens the app on the menu. The only
     * detector for that is a person tapping a shortcut, which is why
     * docs/android-testing.md asks for it by hand.
     */
    @Test
    public void everyShortcutResolvesToTheActivityThatIsAlwaysEnabled() {
        PackageManager pm = context().getPackageManager();
        ComponentName target = new ComponentName(context(), CocktailActivity.class);

        for (String id : ShortcutRoutes.ids()) {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(ShortcutRoutes.uriFor(id)));
            intent.setComponent(target);

            ResolveInfo resolved = pm.resolveActivity(intent, 0);
            assertNotNull("shortcut " + id + " resolves to nothing", resolved);
            assertEquals(
                "shortcut " + id + " does not land on CocktailActivity",
                CocktailActivity.class.getName(),
                resolved.activityInfo.name
            );
        }
    }

    /**
     * And the same point from the other side: whichever alias is currently
     * wearing the launcher filter must not be what a shortcut targets, because
     * that is the component that gets switched off.
     */
    @Test
    public void theShortcutTargetIsNotOneOfTheFlippedAliases() throws Exception {
        PackageManager pm = context().getPackageManager();
        String pkg = "com.bpp.cocktailflashcards";

        for (String alias : new String[] { ".MainActivity", ".FutureLauncher" }) {
            ComponentName name = new ComponentName(pkg, pkg + alias);
            // Present in the manifest at all — a typo here would take the app's
            // launcher entry away entirely.
            ActivityInfo info = pm.getActivityInfo(name, PackageManager.MATCH_DISABLED_COMPONENTS);
            assertNotNull(alias + " is missing from the manifest", info);
            assertEquals(
                alias + " should be an alias for CocktailActivity",
                CocktailActivity.class.getName(),
                info.targetActivity
            );
        }

        // Exactly one of them is live at any moment, which is what makes the
        // pair unusable as a shortcut target.
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(pkg);
        assertEquals(
            "expected exactly one enabled launcher entry",
            1,
            pm.queryIntentActivities(launcher, 0).size()
        );
    }
}
