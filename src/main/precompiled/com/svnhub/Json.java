package com.svnhub;

import java.util.List;
import java.util.Map;

import org.kissweb.json.JSONArray;
import org.kissweb.json.JSONObject;

/**
 * Converts the plain Java collections returned by {@link SvnRepo} (Maps, Lists,
 * scalars) into Kiss {@link JSONObject}/{@link JSONArray} for service responses.
 */
public final class Json {

    private Json() {
    }

    /** Recursively convert a Map/List/scalar tree into Kiss JSON. */
    public static Object toJson(Object v) {
        if (v instanceof Map) {
            JSONObject o = new JSONObject();
            for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
                Object val = toJson(e.getValue());
                if (val != null)
                    o.put(String.valueOf(e.getKey()), val);
            }
            return o;
        }
        if (v instanceof List) {
            JSONArray a = new JSONArray();
            for (Object item : (List<?>) v)
                a.put(toJson(item));
            return a;
        }
        return v;   // String, Number, Boolean, or null
    }

    /** Convert a List of Maps into a JSONArray of JSONObjects. */
    public static JSONArray toJsonArray(List<?> list) {
        JSONArray a = new JSONArray();
        for (Object item : list)
            a.put(toJson(item));
        return a;
    }
}
