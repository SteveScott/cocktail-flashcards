package com.bpp.cocktailflashcards;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.Locale;

import org.junit.Test;

/**
 * Run with: {@code ./gradlew :app:testDebugUnitTest} from android/.
 *
 * ShortcutRoutes is the app's only reader of a string that arrives from outside
 * the process, and almost every input it will ever see is one it must refuse.
 * The launcher icon, Recents, the sign-in return and every deep link all reach
 * CocktailActivity with something other than a shortcut on the intent, and each
 * of them would be a user dumped into a quiz they did not ask for if the parse
 * were loose. Most of what is below is that: the refusals.
 */
public class ShortcutRoutesTest {

    // ── what the launcher sends ────────────────────────────────────────────

    @Test
    public void readsEveryShortcutItDeclares() {
        assertEquals(ShortcutRoutes.STUDY, ShortcutRoutes.idFor("cocktailflashcards://shortcut/study"));
        assertEquals(ShortcutRoutes.SELF_QUIZ, ShortcutRoutes.idFor("cocktailflashcards://shortcut/self-quiz"));
        assertEquals(ShortcutRoutes.EIGHTY_SIX, ShortcutRoutes.idFor("cocktailflashcards://shortcut/86-it"));
    }

    /**
     * The round trip is the actual contract with res/xml/shortcuts.xml: that
     * file holds a literal URI per shortcut, and nothing in the build compares
     * it to this class. What can be checked is that every id the app answers to
     * produces a URI the app then reads back as the same id — so a new id
     * cannot be added here in a shape that silently fails to parse.
     */
    @Test
    public void everyIdSurvivesTheRoundTrip() {
        for (String id : ShortcutRoutes.ids()) {
            assertEquals(id, ShortcutRoutes.idFor(ShortcutRoutes.uriFor(id)));
        }
    }

    @Test
    public void idsAreTheThreeMenuModes() {
        assertArrayEquals(new String[] { "study", "self-quiz", "86-it" }, ShortcutRoutes.ids());
    }

    /** ids() hands out a copy; a caller that sorts it must not reorder the menu. */
    @Test
    public void idsCannotBeEditedFromOutside() {
        String[] taken = ShortcutRoutes.ids();
        taken[0] = "mutated";
        assertEquals("study", ShortcutRoutes.ids()[0]);
    }

    // ── what everything else sends ─────────────────────────────────────────

    /**
     * The ordinary launch. Tapping the icon starts the activity with no data at
     * all, and so does a return from Recents — between them that is nearly every
     * launch the app ever gets.
     */
    @Test
    public void noDataIsNoShortcut() {
        assertNull(ShortcutRoutes.idFor(null));
        assertNull(ShortcutRoutes.idFor(""));
    }

    /** The site itself, which is what the sign-in return arrives as. */
    @Test
    public void theWebsiteIsNotAShortcut() {
        assertNull(ShortcutRoutes.idFor("https://cocktailflashcards.com/?platform=play"));
        assertNull(ShortcutRoutes.idFor("https://cocktailflashcards.com/shortcut/study"));
    }

    /** The app's own custom_url_scheme, which Capacitor and Firebase both use. */
    @Test
    public void theAuthSchemeIsNotAShortcut() {
        assertNull(ShortcutRoutes.idFor("com.bpp.cocktailflashcards://shortcut/study"));
        assertNull(ShortcutRoutes.idFor("com.bpp.cocktailflashcards:/oauth2redirect"));
    }

    /** Right scheme, wrong host — a path that was never a shortcut. */
    @Test
    public void anotherHostIsNotAShortcut() {
        assertNull(ShortcutRoutes.idFor("cocktailflashcards://recipe/study"));
        assertNull(ShortcutRoutes.idFor("cocktailflashcards://shortcut"));
        assertNull(ShortcutRoutes.idFor("cocktailflashcards://shortcut/"));
    }

    /**
     * A shortcut pinned to the home screen outlives the build that created it.
     * Retire an id and the pinned copy keeps launching with it, so an unknown
     * name has to mean "open normally" rather than throw on the way up.
     */
    @Test
    public void aRetiredIdOpensTheAppAnyway() {
        assertNull(ShortcutRoutes.idFor("cocktailflashcards://shortcut/flashcards"));
        assertNull(ShortcutRoutes.idFor("cocktailflashcards://shortcut/study/extra"));
    }

    // ── the shapes a URI can legitimately take ─────────────────────────────

    /** Scheme and host fold case per RFC 3986; a launcher may hand back either. */
    @Test
    public void schemeAndHostAreCaseInsensitive() {
        assertEquals("study", ShortcutRoutes.idFor("CocktailFlashcards://SHORTCUT/study"));
    }

    /**
     * And it folds the same way whatever locale the phone is in.
     *
     * The scheme contains an i, and Turkish lowercases I to a dotless ı — a
     * default-locale fold would quietly stop recognising an upper-case scheme
     * on a tr-TR device and nowhere else, which is the kind of bug that gets
     * closed as unreproducible.
     */
    @Test
    public void foldsTheSameWayInEveryLocale() {
        Locale was = Locale.getDefault();
        try {
            Locale.setDefault(new Locale("tr", "TR"));
            assertEquals("study", ShortcutRoutes.idFor("COCKTAILFLASHCARDS://SHORTCUT/study"));
        } finally {
            Locale.setDefault(was);
        }
    }

    /**
     * The path does not fold, and must not. The ids are matched as literals on
     * the JavaScript side too (SHORTCUTS in src/app-shortcuts.js), so accepting
     * "Study" here would hand across a string that fails the check there and
     * silently does nothing.
     */
    @Test
    public void thePathDoesNotFoldCase() {
        assertNull(ShortcutRoutes.idFor("cocktailflashcards://shortcut/Study"));
        assertNull(ShortcutRoutes.idFor("cocktailflashcards://shortcut/SELF-QUIZ"));
    }

    /** Whitespace and a trailing slash from a URI builder are not a refusal. */
    @Test
    public void tidiesWhatABuilderMayHaveAdded() {
        assertEquals("study", ShortcutRoutes.idFor("  cocktailflashcards://shortcut/study  "));
        assertEquals("86-it", ShortcutRoutes.idFor("cocktailflashcards://shortcut/86-it/"));
    }

    /** A query or fragment nobody put there on purpose is dropped, not fatal. */
    @Test
    public void ignoresAQueryOrFragment() {
        assertEquals("study", ShortcutRoutes.idFor("cocktailflashcards://shortcut/study?from=launcher"));
        assertEquals("self-quiz", ShortcutRoutes.idFor("cocktailflashcards://shortcut/self-quiz#top"));
    }

    /** Short strings must not reach a substring that runs off the end. */
    @Test
    public void survivesStringsShorterThanThePrefix() {
        assertNull(ShortcutRoutes.idFor("c"));
        assertNull(ShortcutRoutes.idFor("cocktailflashcards:/"));
    }

    // ── isKnown / uriFor ───────────────────────────────────────────────────

    @Test
    public void isKnownAnswersForTheIdsOnly() {
        assertTrue(ShortcutRoutes.isKnown("study"));
        assertFalse(ShortcutRoutes.isKnown("Study"));
        assertFalse(ShortcutRoutes.isKnown(null));
        assertFalse(ShortcutRoutes.isKnown("cocktailflashcards://shortcut/study"));
    }

    /**
     * uriFor throws where idFor returns null, and the asymmetry is on purpose:
     * idFor is handed strings by the world, uriFor is handed strings by this
     * codebase. A bad one there is a typo in a file someone just edited, and it
     * should stop rather than produce a URI that quietly matches nothing.
     */
    @Test
    public void uriForRefusesAnIdItDoesNotHave() {
        try {
            ShortcutRoutes.uriFor("nightcap");
            fail("expected uriFor to reject an unknown id");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("nightcap"));
        }
    }
}
