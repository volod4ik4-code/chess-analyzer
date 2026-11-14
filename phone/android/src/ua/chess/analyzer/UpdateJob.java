package ua.chess.analyzer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Фонова перевірка оновлень (раз на кілька годин, навіть коли програму закрито):
 * якщо на GitHub вийшла новіша версія - сповіщення в шторці Android «Доступна нова версія».
 */
public class UpdateJob extends JobService {
    static final String API = "https://api.github.com/repos/volod4ik4-code/chess-analyzer/releases?per_page=20";
    static final int JOB_ID = 1;
    static final String CHANNEL = "updates";

    static final long PERIOD = 60 * 60 * 1000L;          // раз на годину

    /** Ставить перевірку в розклад (якщо вже стоїть з тим самим інтервалом - не чіпає). */
    static void schedule(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        JobInfo old = js.getPendingJob(JOB_ID);
        if (old != null && old.getIntervalMillis() == PERIOD) return;
        if (old != null) js.cancel(JOB_ID);                // старий розклад (раз на 6 годин) - замінюємо
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(c, UpdateJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(PERIOD)
                .setPersisted(true)
                .build();
        try {
            js.schedule(job);
        } catch (Exception ignored) {
        }
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    check(UpdateJob.this);
                } catch (Exception ignored) {
                }
                jobFinished(params, false);
            }
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    static int[] ver(String s) {
        int[] v = new int[4];                      // 1.26.0: багфікс X.Y.Z.N
        Matcher m = Pattern.compile("(\\d+)\\.(\\d+)\\.(\\d+)(?:\\.(\\d+))?").matcher(s == null ? "" : s);
        if (m.find()) for (int i = 0; i < 4; i++) v[i] = m.group(i + 1) == null ? 0 : Integer.parseInt(m.group(i + 1));
        return v;
    }

    static int cmp(int[] a, int[] b) {
        for (int i = 0; i < 4; i++) if (a[i] != b[i]) return a[i] - b[i];
        return 0;
    }

    static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    /** Версія, яка зараз працює: APK або новіше маленьке оновлення сторінки (files/www/version.json). */
    static String currentVersion(Context c) {
        String v = "0.0.0";
        try {
            v = c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (Exception ignored) {
        }
        try {
            String w = new JSONObject(readAll(new FileInputStream(new File(c.getFilesDir(), "www/version.json"))))
                    .optString("version", "");
            if (!w.isEmpty() && cmp(ver(w), ver(v)) > 0) v = w;
        } catch (Exception ignored) {
        }
        return v;
    }

    static void check(Context c) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(API).openConnection();
        con.setConnectTimeout(20000);
        con.setReadTimeout(20000);
        con.setRequestProperty("Accept", "application/vnd.github+json");
        con.setRequestProperty("User-Agent", "ChessAnalyzer");
        if (con.getResponseCode() != 200) return;
        // найновіший реліз, у якому є файл для телефона (APK або маленьке оновлення); релізи лише для ПК - пропускаємо
        JSONArray rels = new JSONArray(readAll(con.getInputStream()));
        con.disconnect();
        String tag = "";
        for (int i = 0; i < rels.length(); i++) {
            JSONObject r = rels.getJSONObject(i);
            if (r.optBoolean("draft") || r.optBoolean("prerelease")) continue;
            JSONArray as = r.optJSONArray("assets");
            // версія - з назви файлу телефона, а не з номера релізу: у релізі лише для ПК лежить старий APK
            String t = "";
            for (int k = 0; as != null && k < as.length(); k++) {
                String n = as.getJSONObject(k).optString("name", "").toLowerCase(Locale.ROOT);
                if (n.endsWith(".apk")) t = n;
                else if (t.isEmpty() && n.matches(".*-web-n\\d+\\.zip")) t = n;
            }
            if (!t.isEmpty() && ver(t)[0] == 0 && ver(t)[1] == 0) t = r.optString("tag_name", "");
            if (!t.isEmpty() && (tag.isEmpty() || cmp(ver(t), ver(tag)) > 0)) tag = t;
        }
        if (tag.isEmpty() || cmp(ver(tag), ver(currentVersion(c))) <= 0) return;
        SharedPreferences sp = c.getSharedPreferences("updates", Context.MODE_PRIVATE);
        if (tag.equals(sp.getString("notified", ""))) return;          // про цю версію вже повідомили
        int[] tv = ver(tag);
        notify(c, tv[0] + "." + tv[1] + "." + tv[2]);
        sp.edit().putString("notified", tag).apply();
    }

    static void notify(Context c, String version) {
        boolean uk = Locale.getDefault().getLanguage().startsWith("uk");
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, uk ? "Оновлення" : "Updates",
                    NotificationManager.IMPORTANCE_DEFAULT);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(c, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL)
                : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(uk ? "Доступна нова версія " + version : "New version " + version + " is available")
                .setContentText(uk ? "Натисніть, щоб оновити аналізатор" : "Tap to update Chess Analyzer")
                .setContentIntent(pi)
                .setAutoCancel(true);
        nm.notify(2, b.build());
    }
}
