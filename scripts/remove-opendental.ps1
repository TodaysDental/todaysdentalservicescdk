# remove-opendental.ps1
# Deletes all files/directories that are purely OpenDental-specific

$base = "C:\Users\today\OneDrive\INSIGHTS\tdscopy"

# 1. Entire directories dedicated to OpenDental
$dirsToDelete = @(
    "$base\src\services\opendental",
    "$base\src\integrations\open-dental"
)

foreach ($dir in $dirsToDelete) {
    if (Test-Path $dir) {
        Remove-Item -Recurse -Force $dir
        Write-Host "DELETED DIR: $dir"
    } else {
        Write-Host "NOT FOUND:   $dir"
    }
}

# 2. Specific OpenDental-dedicated files
$filesToDelete = @(
    "$base\src\shared\utils\opendental-api.ts",
    "$base\src\infrastructure\stacks\opendental-stack.ts",
    "$base\src\infrastructure\stacks\fluoride-automation-stack.ts"
)

foreach ($file in $filesToDelete) {
    if (Test-Path $file) {
        Remove-Item -Force $file
        Write-Host "DELETED FILE: $file"
    } else {
        Write-Host "NOT FOUND:    $file"
    }
}

Write-Host "`nDone. Remaining OpenDental references in other files must be cleaned manually."
