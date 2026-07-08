package com.svnhub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import org.junit.jupiter.api.Test;

/**
 * Tests for {@link SvnLogParser} against the real svnserve 1.14 log format.
 */
public class SvnLogParserTest {

    @Test
    void parsesCheckout() {
        SvnLogParser.Event e = SvnLogParser.parse(
                "109138 2026-06-19T14:23:06.300767Z 127.0.0.1 kiss acme checkout-or-export / r1");
        assertEquals("checkout-or-export", e.action);
        assertEquals("checkout", e.category);
        assertEquals("read", e.verbClass);
        assertEquals("acme", e.repoKey);
        assertEquals("kiss", e.rawUser);
        assertEquals("127.0.0.1", e.clientHost);
        assertEquals(Integer.valueOf(1), e.revision);
        assertEquals("/", e.path);
    }

    @Test
    void parsesCommitWithNoPath() {
        SvnLogParser.Event e = SvnLogParser.parse(
                "114184 2026-06-19T14:30:31.932070Z 127.0.0.1 kiss acme commit r2");
        assertEquals("commit", e.category);
        assertEquals("write", e.verbClass);
        assertEquals(Integer.valueOf(2), e.revision);
        assertNull(e.path);
    }

    @Test
    void anonymousUserAndErrLine() {
        SvnLogParser.Event e = SvnLogParser.parse(
                "109129 2026-06-19T14:23:06.270854Z 127.0.0.1 - - ERR - 0 210002 Network connection closed unexpectedly");
        assertNull(e.rawUser);
        assertNull(e.repoKey);
        assertEquals("ERR", e.action);
        assertEquals("other", e.category);
        assertEquals("other", e.verbClass);
    }

    @Test
    void checkPathStripsPegRevision() {
        SvnLogParser.Event e = SvnLogParser.parse(
                "109138 2026-06-19T14:23:06.292536Z 127.0.0.1 kiss acme check-path /@1");
        assertEquals("check-path", e.action);
        assertEquals("browse", e.category);
        assertEquals("/", e.path);
        assertEquals(Integer.valueOf(1), e.revision);
    }

    @Test
    void switchReadsTargetPegRevision() {
        SvnLogParser.Event e = SvnLogParser.parse(
                "87164 2026-07-07T20:08:42.421768Z 127.0.0.1 - admin/svn-hub-main switch /trunk /branches/theme-blue-rework@5");
        assertEquals("switch", e.action);
        assertEquals("switch", e.category);
        assertEquals("read", e.verbClass);
        assertNull(e.rawUser);
        assertEquals("admin/svn-hub-main", e.repoKey);
        assertEquals("/trunk", e.path);
        assertEquals(Integer.valueOf(5), e.revision);
        assertEquals("/branches/theme-blue-rework", e.extra);
    }

    @Test
    void listKeepsPathAndRevisionAndExtra() {
        SvnLogParser.Event e = SvnLogParser.parse(
                "109125 2026-06-19T14:23:06.260215Z 127.0.0.1 kiss acme list / r1 depth=immediates <ANY>");
        assertEquals("list", e.action);
        assertEquals("/", e.path);
        assertEquals(Integer.valueOf(1), e.revision);
        assertEquals("depth=immediates <ANY>", e.extra);
    }

    @Test
    void blankAndNullLines() {
        assertNull(SvnLogParser.parse(null));
        assertNull(SvnLogParser.parse("   "));
    }

    @Test
    void unparseableShortLine() {
        SvnLogParser.Event e = SvnLogParser.parse("garbage line");
        assertEquals("UNPARSED", e.action);
        assertEquals("other", e.verbClass);
    }

    @Test
    void unparseableBadTimestamp() {
        SvnLogParser.Event e = SvnLogParser.parse("123 not-a-timestamp 127.0.0.1 kiss acme list / r1");
        assertEquals("UNPARSED", e.action);
    }

    @Test
    void timestampParsesToEpochMillis() {
        SvnLogParser.Event e = SvnLogParser.parse(
                "1 2026-06-19T14:23:06.300767Z 127.0.0.1 kiss acme list / r1");
        assertEquals(Instant.parse("2026-06-19T14:23:06.300767Z").toEpochMilli(), e.tsMillis);
        assertTrue(e.day >= 20260618 && e.day <= 20260620);
    }
}
