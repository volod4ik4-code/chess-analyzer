package ua.chess.analyzer;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Віддає завантажений файл оновлення (update.apk) установнику Android.
 * Замість androidx FileProvider (у збірці немає бібліотек androidx).
 */
public class ApkProvider extends ContentProvider {
    static final String AUTHORITY = "ua.chess.analyzer.updates";
    static final String NAME = "update.apk";

    static File file(android.content.Context c) {
        return new File(c.getCacheDir(), NAME);
    }

    static Uri uri() {
        return Uri.parse("content://" + AUTHORITY + "/" + NAME);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!NAME.equals(uri.getLastPathSegment())) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(file(getContext()), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String sel, String[] args, String sort) {
        MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        c.addRow(new Object[]{NAME, file(getContext()).length()});
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues v) {
        return null;
    }

    @Override
    public int delete(Uri uri, String sel, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues v, String sel, String[] args) {
        return 0;
    }
}
