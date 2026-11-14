# Збірка «Chess Analyzer.apk» без Android Studio і Gradle: aapt2 + javac + d8 + zipalign + apksigner.
# Інструменти й ключ підпису - у %USERPROFILE%\.chess_analyzer_android (jdk, sdk, key).
# Поруч з цим файлом: www\ (сторінка програми), android\ (маніфест, ресурси, MainActivity.java),
# nativelib\arm64-v8a\libstockfish.so (офіційний Stockfish 19 stockfish-android-arm64-universal; у assets/src
# його немає - завантажити з github.com/official-stockfish/Stockfish/releases/tag/sf_19).
# Використання: powershell -File build.ps1 -Out "шлях\Chess Analyzer.apk"
param([Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = "$env:USERPROFILE\.chess_analyzer_android"
$bt = "$root\sdk\build-tools\35.0.0"
$jar = "$root\sdk\platforms\android-35\android.jar"
$env:JAVA_HOME = "$root\jdk"
$env:Path = "$root\jdk\bin;$env:Path"
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed ($LASTEXITCODE)" } }

$b = Join-Path $here "build"
if (Test-Path $b) { Remove-Item -Recurse -Force $b }
New-Item -ItemType Directory -Force "$b\gen", "$b\classes", "$b\dex", "$b\assets\www", "$b\assets\src" | Out-Null

# версія - з data.js (згенерованого з chess_analyzer.py)
$m = [regex]::Match((Get-Content "$here\www\data.js" -Raw -Encoding UTF8), '"APP_VERSION":\s*"(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?"')
if (-not $m.Success) { throw "APP_VERSION not found in data.js" }
# 1.26.0: X.Y.Z або багфікс X.Y.Z.N; код = X*1000000 + Y*10000 + Z*100 + N (більший за старі 12519)
$fix = if ($m.Groups[4].Success) { [int]$m.Groups[4].Value } else { 0 }
$vname = "$($m.Groups[1].Value).$($m.Groups[2].Value).$($m.Groups[3].Value)" + $(if ($fix) { ".$fix" } else { "" })
$vcode = [int]$m.Groups[1].Value * 1000000 + [int]$m.Groups[2].Value * 10000 + [int]$m.Groups[3].Value * 100 + $fix

# сторінка програми + вихідні файли для повторної збірки (assets/src)
Get-ChildItem "$here\www" | Where-Object { $_.Name -ne 'test' } | Copy-Item -Destination "$b\assets\www" -Recurse
Copy-Item "$here\android" "$b\assets\src\android" -Recurse
Copy-Item "$here\build.ps1", "$here\gen_data.py" "$b\assets\src\"

& "$bt\aapt2.exe" compile --dir "$here\android\res" -o "$b\res.zip"; Check "aapt2 compile"
& "$bt\aapt2.exe" link -o "$b\base.apk" -I $jar --manifest "$here\android\AndroidManifest.xml" "$b\res.zip" `
    --java "$b\gen" --min-sdk-version 24 --target-sdk-version 34 --version-code $vcode --version-name $vname `
    -A "$b\assets" -0 wasm --auto-add-overlay; Check "aapt2 link"

$java = @(Get-ChildItem "$b\gen", "$here\android\src" -Recurse -Filter *.java | ForEach-Object FullName)
& javac -source 8 -target 8 -encoding UTF-8 -Xlint:-options -bootclasspath $jar -d "$b\classes" @java; Check "javac"
$classes = Get-ChildItem "$b\classes" -Recurse -Filter *.class | ForEach-Object FullName
& "$bt\d8.bat" --release --min-api 24 --lib $jar --output "$b\dex" @classes; Check "d8"

# переписуємо архів начисто (те саме стиснення для кожного файлу) і додаємо classes.dex
python -c "import sys,zipfile; s=zipfile.ZipFile(sys.argv[1]); d=zipfile.ZipFile(sys.argv[2],'w'); [d.writestr(i.filename, s.read(i.filename), compress_type=i.compress_type) for i in s.infolist()]; d.write(sys.argv[3],'classes.dex',compress_type=zipfile.ZIP_DEFLATED); d.write(sys.argv[4],'lib/arm64-v8a/libstockfish.so',compress_type=zipfile.ZIP_DEFLATED); d.close()" "$b\base.apk" "$b\unaligned.apk" "$b\dex\classes.dex" "$here\nativelib\arm64-v8a\libstockfish.so"; Check "add dex"
& "$bt\zipalign.exe" -p -f 4 "$b\unaligned.apk" "$b\aligned.apk"; Check "zipalign"

# ключ підпису: один і той самий для всіх версій (інакше оновлення не встановиться поверх старої)
$ks = "$root\key\release.jks"
$pwFile = "$root\key\password.txt"
if (-not (Test-Path $ks)) {
    New-Item -ItemType Directory -Force "$root\key" | Out-Null
    $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    [IO.File]::WriteAllText($pwFile, $pw)
    & keytool -genkeypair -keystore $ks -storetype PKCS12 -alias chessanalyzer -keyalg RSA -keysize 2048 `
        -validity 36500 -storepass $pw -keypass $pw -dname "CN=Chess Analyzer" | Out-Null; Check "keytool"
}
& "$bt\apksigner.bat" sign --ks $ks --ks-pass "file:$pwFile" --out "$b\signed.apk" "$b\aligned.apk"; Check "apksigner sign"
& "$bt\apksigner.bat" verify "$b\signed.apk"; Check "apksigner verify"
Copy-Item "$b\signed.apk" $Out -Force
"APK $vname ($vcode): " + [math]::Round((Get-Item $Out).Length / 1MB, 1) + " MB -> $Out"
