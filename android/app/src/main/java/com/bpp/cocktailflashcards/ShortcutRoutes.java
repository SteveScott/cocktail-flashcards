package com.bpp.cocktailflashcards;

import java.util.Locale;

/**
 * The launcher's long-press menu, as data — and the one place that knows how a
 * shortcut names itself.
 *
 * Each shortcut launches CocktailActivity with
 * {@code cocktailflashcards://shortcut/<id>} on the intent, and this class is
 * both ends of that string — {@link #uriFor} writes what shortcuts.xml must
 * contain, and {@link #idFor} reads what arrives.
 *
 * <p>A URI rather than an intent extra, and that is the choice worth defending:
 * a URI is one string, so the whole contract with the launcher collapses into a
 * pure function with an input and an output. An extras bundle would put the
 * same decision inside a Bundle nobody can construct off a device. Everything
 * below is testable on the JVM because of it.
 *
 * <p>Deliberately free of {@code android.net.Uri}, and of every other framework
 * type. Uri is a stub on the JVM — its methods throw rather than parse — so a
 * class that touched it could only be tested on a device, and this is the part
 * with the edge cases. Plain string handling here keeps
 * ShortcutRoutesTest a real unit test that runs on {@code ./gradlew test}.
 *
 * <p>The ids are matched against the app's modes in src/app-shortcuts.js; adding
 * one means adding it here, in shortcuts.xml, and to SHORTCUTS in that file.
 */
public final class ShortcutRoutes {

    /** Not the app's {@code custom_url_scheme} — this one never leaves the device. */
    public static final String SCHEME = "cocktailflashcards";
    public static final String HOST = "shortcut";

    private static final String PREFIX = SCHEME + "://" + HOST + "/";

    /** Study Mode — the flashcard deck. */
    public static final String STUDY = "study";
    /** Self Quiz — reveal and grade yourself. */
    public static final String SELF_QUIZ = "self-quiz";
    /** 86 It — spot the ingredients that do not belong. */
    public static final String EIGHTY_SIX = "86-it";

    private static final String[] IDS = { STUDY, SELF_QUIZ, EIGHTY_SIX };

    private ShortcutRoutes() {}

    /** The URI a shortcut with this id must carry. Mirrors res/xml/shortcuts.xml. */
    public static String uriFor(String id) {
        if (!isKnown(id)) {
            throw new IllegalArgumentException("No shortcut with id: " + id);
        }
        return PREFIX + id;
    }

    /**
     * The shortcut id a launch URI names, or null if it names none.
     *
     * <p>Null rather than a default, and that matters: this is asked of every
     * intent that starts the activity, and the overwhelming majority of them —
     * the launcher icon itself, a return from Recents, the sign-in redirect —
     * carry no data at all. Answering STUDY to those would drag a user who
     * tapped the icon into the deck.
     *
     * <p>Anything unrecognised is also null rather than an exception. The string
     * comes from outside the app: an {@code adb} intent, another app's
     * {@code startActivity}, or a shortcut pinned to the home screen by an
     * older build whose id this one no longer has. None of those is a reason to
     * fail to start.
     */
    public static String idFor(String uri) {
        if (uri == null) return null;

        String s = uri.trim();
        // A URI's scheme and host are case-insensitive; the path is not. Lower
        // the prefix only, so a pinned cocktailflashcards://SHORTCUT/study still
        // resolves while a stray "Study" is still correctly unknown. Locale.ROOT
        // rather than the default, because the scheme contains an i and the
        // Turkish locale lowercases I to a dotless one — a phone set to tr-TR
        // would otherwise refuse an upper-case scheme it should have taken.
        if (s.length() < PREFIX.length()) return null;
        if (!s.substring(0, PREFIX.length()).toLowerCase(Locale.ROOT).equals(PREFIX)) return null;

        String rest = s.substring(PREFIX.length());
        // Drop a query or fragment nobody put there on purpose, and a trailing
        // slash a URI builder may have added.
        int cut = indexOfAny(rest, '?', '#');
        if (cut >= 0) rest = rest.substring(0, cut);
        while (rest.endsWith("/")) rest = rest.substring(0, rest.length() - 1);

        return isKnown(rest) ? rest : null;
    }

    /** Whether this is an id the app still answers to. */
    public static boolean isKnown(String id) {
        if (id == null) return false;
        for (String known : IDS) {
            if (known.equals(id)) return true;
        }
        return false;
    }

    /** Every id, in the order the launcher lists them. */
    public static String[] ids() {
        return IDS.clone();
    }

    private static int indexOfAny(String s, char a, char b) {
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) == a || s.charAt(i) == b) return i;
        }
        return -1;
    }
}
