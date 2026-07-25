# Appwrite Sites frontend deployment

Use these settings after the separation diff is approved and merged:

| Setting | Value |
| --- | --- |
| Framework | Other |
| Rendering | Static site |
| Production branch | `main` |
| Root Directory | `./domain-hosting` |
| Install Command | empty |
| Build Command | empty |
| Output Directory | `./` |

The folder already contains the complete verified frontend; no command should
copy only the old Coming Soon files. The production API base is
`https://api.shendeti-im.me`. Local static serving automatically uses
`http://localhost:5500`.

Add the exact Appwrite Sites preview origin to the Render
`ALLOWED_ORIGINS` value before preview testing.
