package nl.leukekeuze.vondst;

import android.content.Context;
import android.content.SharedPreferences;
import android.location.Location;
import android.location.LocationManager;
import org.json.JSONArray;
import org.json.JSONObject;

// Spelden die gezet zijn terwijl het scherm op slot was. De app haalt ze op zodra hij weer open gaat.
public class Spelden {
    private static final String NAAM = "vondst_spelden";

    static synchronized void zet(Context c, String woord) {
        Location beste = null;
        try {
            LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
            for (String p : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, "fused" }) {
                try {
                    Location l = lm.getLastKnownLocation(p);
                    if (l != null && (beste == null || l.getTime() > beste.getTime())) beste = l;
                } catch (Exception e) { }
            }
        } catch (Exception e) { }
        try {
            SharedPreferences sp = c.getSharedPreferences(NAAM, Context.MODE_PRIVATE);
            JSONArray a = new JSONArray(sp.getString("lijst", "[]"));
            JSONObject o = new JSONObject();
            long nu = System.currentTimeMillis();
            o.put("t", nu);
            o.put("woord", woord);
            if (beste != null) {
                o.put("lat", beste.getLatitude());
                o.put("lon", beste.getLongitude());
                o.put("acc", beste.getAccuracy());
                o.put("gpsLeeftijd", nu - beste.getTime());
            }
            a.put(o);
            sp.edit().putString("lijst", a.toString()).apply();
        } catch (Exception e) { }
    }

    static synchronized String haalEnLeeg(Context c) {
        SharedPreferences sp = c.getSharedPreferences(NAAM, Context.MODE_PRIVATE);
        String s = sp.getString("lijst", "[]");
        sp.edit().putString("lijst", "[]").apply();
        return s;
    }
}
