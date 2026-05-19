# Walk First

Find whether walking a few blocks before getting a ride saves time.

## How It Works

1. Enter your pickup location and destination
2. The app generates ~24 candidate pickup points around your origin (1-2 blocks in each direction)
3. Compares walk time + ride time from each candidate against a direct ride
4. Shows you any routes that beat or match the direct ride time

**Distance assumptions:**
- 1 block (north/south) = 250 ft
- 1 avenue (east/west) = 800 ft
- Walking speed = 3 mph

## Setup

### 1. Get a Google Maps API Key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the following APIs:
   - **Geocoding API** - for converting addresses to coordinates
   - **Distance Matrix API** - for calculating drive times

   To enable each API:
   - Go to **APIs & Services** > **Library**
   - Search for the API name
   - Click on it and press **Enable**

4. Create credentials:
   - Go to **APIs & Services** > **Credentials**
   - Click **Create Credentials** > **API Key**
   - Copy the generated API key

5. (Recommended) Restrict your API key:
   - Click on your newly created API key
   - Under **API restrictions**, select **Restrict key**
   - Select only **Geocoding API** and **Distance Matrix API**
   - Save

### 2. Configure the App

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your API key:
   ```
   GOOGLE_MAPS_API_KEY=your_actual_api_key_here
   ```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the App

```bash
npm start
```

Open http://localhost:3000 in your browser.

## Usage Tips

- Use full addresses for best results (e.g., "350 5th Ave, New York, NY")
- Works best in urban grid-based areas like Manhattan
- Results depend on current traffic conditions from Google Maps

## API Costs

This app uses Google Maps APIs which have usage-based pricing:
- **Geocoding**: $5 per 1,000 requests
- **Distance Matrix**: $5 per 1,000 elements

Each route calculation uses:
- 2 geocoding requests (origin + destination)
- ~25 distance matrix elements (direct + candidates)

Google provides $200/month free credit, which covers roughly 8,000 calculations per month.
