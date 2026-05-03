# Personal Finance BI Dashboard

Password-protected BI dashboard backed by a published Google Sheet CSV.

## Local Run

```powershell
$env:DASHBOARD_USER="demo"
$env:DASHBOARD_PASSWORD="demo123"
npm start
```

Open:

```text
http://127.0.0.1:5173/index.html
```

## Deploy To Render

1. Create a GitHub repository and upload these files.
2. Open Render and create a new Web Service from that repository.
3. Use:
   - Runtime: Node
   - Build Command: leave empty
   - Start Command: `npm start`
4. Add environment variables:
   - `DASHBOARD_USER`
   - `DASHBOARD_PASSWORD`
   - `GOOGLE_CSV_URL`
   - `EXCHANGE_RATE_URL`
5. Deploy.

After deployment, Render will provide an HTTPS URL. Visitors will be asked for the username and password before they can view the dashboard.

## Environment Variables

```text
DASHBOARD_USER=your-username
DASHBOARD_PASSWORD=your-strong-password
GOOGLE_CSV_URL=https://docs.google.com/spreadsheets/d/your-sheet-id/gviz/tq?tqx=out:csv&gid=your-gid
EXCHANGE_RATE_URL=https://open.er-api.com/v6/latest/USD
```

## Notes

The dashboard reads Google Sheets through the CSV export endpoint. Anyone with that CSV URL can access the raw data if the sheet is shared publicly. For private source data, replace CSV access with Google Sheets API access through a service account.
