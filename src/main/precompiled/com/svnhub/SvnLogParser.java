package com.svnhub;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.regex.Pattern;

/**
 * Parser for the svnserve {@code --log-file} operational log (svnserve 1.10+).
 *
 * Each line is space-delimited:
 * <pre>
 *   &lt;pid&gt; &lt;ISO8601-timestamp&gt; &lt;client-ip&gt; &lt;user&gt; &lt;repos&gt; &lt;action&gt; &lt;args...&gt;
 * </pre>
 * e.g.
 * <pre>
 *   109138 2026-06-19T14:23:06.300767Z 127.0.0.1 kiss acme checkout-or-export / r1
 *   114184 2026-06-19T14:30:31.932070Z 127.0.0.1 kiss acme commit r2
 *   109129 2026-06-19T14:23:06.270854Z 127.0.0.1 - - ERR - 0 210002 Network connection closed unexpectedly
 * </pre>
 *
 * {@code user} and {@code repos} are {@code -} when absent. The repository name
 * is a dedicated field (no path-prefix derivation needed). Unparseable lines
 * are returned as an {@code UNPARSED} event rather than dropped.
 */
public final class SvnLogParser {

    private static final Pattern REV = Pattern.compile("^r(\\d+)$");
    private static final Pattern PEG_REV = Pattern.compile("^(.+)@(\\d+)$");

    private SvnLogParser() {
    }

    /** A parsed log line.  Public fields keep Groovy access and unit tests simple. */
    public static final class Event {
        public long tsMillis;
        public int day;            // YYYYMMDD (system zone)
        public String clientHost;
        public String rawUser;     // null when '-'
        public String repoKey;     // null when '-'
        public String action;      // verbatim svn verb, or "UNPARSED"
        public String category;    // checkout|update|switch|browse|commit|lock|other
        public String verbClass;   // read|write|lock|other
        public Integer revision;   // null if none present
        public String path;        // null if none present
        public String extra;       // remaining args
        public String raw;         // original line
    }

    /**
     * Parse one log line.
     *
     * @return the parsed Event, or null for a blank line.
     */
    public static Event parse(String line) {
        if (line == null)
            return null;
        String trimmed = line.trim();
        if (trimmed.isEmpty())
            return null;

        Event e = new Event();
        e.raw = line;

        String[] tok = trimmed.split("\\s+");
        // need at least: pid ts ip user repos action
        if (tok.length < 6) {
            unparsed(e);
            return e;
        }
        Long ts = parseTs(tok[1]);
        if (ts == null) {
            unparsed(e);
            return e;
        }
        e.tsMillis = ts;
        e.day = dayOf(ts);
        e.clientHost = tok[2];
        e.rawUser = dash(tok[3]);
        e.repoKey = dash(tok[4]);
        e.action = tok[5];
        e.category = categorize(e.action);
        e.verbClass = verbClass(e.category);

        // Scan the remaining args for a path (first '/'-token) and a revision (r<digits>).
        StringBuilder extra = new StringBuilder();
        for (int i = 6; i < tok.length; i++) {
            String t = tok[i];
            if (e.revision == null) {
                java.util.regex.Matcher m = REV.matcher(t);
                if (m.matches()) {
                    e.revision = Integer.parseInt(m.group(1));
                    continue;
                }
            }
            if (e.path == null && t.startsWith("/")) {
                java.util.regex.Matcher peg = PEG_REV.matcher(t);
                if (peg.matches()) {
                    t = peg.group(1);
                    if (e.revision == null)
                        e.revision = Integer.parseInt(peg.group(2));
                }
                e.path = t.isEmpty() ? "/" : t;
                continue;
            }
            if (e.revision == null && t.startsWith("/")) {
                java.util.regex.Matcher peg = PEG_REV.matcher(t);
                if (peg.matches()) {
                    e.revision = Integer.parseInt(peg.group(2));
                    if (extra.length() > 0)
                        extra.append(' ');
                    extra.append(peg.group(1));
                    continue;
                }
            }
            if (extra.length() > 0)
                extra.append(' ');
            extra.append(t);
        }
        e.extra = extra.length() == 0 ? null : extra.toString();
        return e;
    }

    /** Map a svn verb to a coarse statistics category. */
    public static String categorize(String action) {
        if (action == null)
            return "other";
        switch (action) {
            case "checkout-or-export":
                return "checkout";
            case "update":
                return "update";
            case "switch":
                return "switch";
            case "commit":
                return "commit";
            case "lock":
            case "unlock":
                return "lock";
            case "list":
            case "get-dir":
            case "get-file":
            case "check-path":
            case "stat":
            case "log":
            case "diff":
            case "status":
            case "get-latest-rev":
            case "get-locations":
            case "get-location-segments":
            case "get-file-revs":
            case "get-mergeinfo":
            case "replay":
            case "replay-range":
            case "rev-proplist":
            case "rev-prop":
                return "browse";
            default:
                return "other";
        }
    }

    public static String verbClass(String category) {
        switch (category) {
            case "checkout":
            case "update":
            case "switch":
            case "browse":
                return "read";
            case "commit":
                return "write";
            case "lock":
                return "lock";
            default:
                return "other";
        }
    }

    private static void unparsed(Event e) {
        e.action = "UNPARSED";
        e.category = "other";
        e.verbClass = "other";
        e.extra = e.raw;
    }

    private static String dash(String s) {
        return (s == null || s.equals("-")) ? null : s;
    }

    private static Long parseTs(String s) {
        try {
            return Instant.parse(s).toEpochMilli();
        } catch (Exception ex) {
            return null;
        }
    }

    private static int dayOf(long ms) {
        LocalDate d = LocalDate.ofInstant(Instant.ofEpochMilli(ms), ZoneId.systemDefault());
        return d.getYear() * 10000 + d.getMonthValue() * 100 + d.getDayOfMonth();
    }
}
