# Read-only MongoDB migration helpers

`collection-counts.js` prints collection names and counts only. It never prints
documents, credentials, medical content, names, emails, or file paths.

Source:

```powershell
$env:SOURCE_MONGODB_URI='<set-privately>'
node scripts/migration/collection-counts.js --source --confirm-read
```

Target:

```powershell
$env:TARGET_MONGODB_URI='<set-privately>'
node scripts/migration/collection-counts.js --target --confirm-read
```

The helper refuses `--apply`. Store any captured output outside the repository.
