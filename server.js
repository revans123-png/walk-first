require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Constants for distance calculations
const FEET_PER_METER = 3.28084;
const BLOCK_FEET = 250; // North/South
const AVENUE_FEET = 800; // East/West
const WALK_SPEED_MPH = 3;
const FEET_PER_MILE = 5280;
const MAX_WALK_TIME_SECS = 360; // 6 minutes max walk

// Convert feet to degrees latitude (north/south)
function feetToLatDegrees(feet) {
  // 1 degree latitude ≈ 364,000 feet
  return feet / 364000;
}

// Convert feet to degrees longitude (east/west) at a given latitude
function feetToLngDegrees(feet, latitude) {
  // 1 degree longitude varies by latitude
  const feetPerDegree = 364000 * Math.cos(latitude * Math.PI / 180);
  return feet / feetPerDegree;
}

// Generate candidate pickup points around origin
function generateCandidates(originLat, originLng) {
  const candidates = [];

  // Direction offsets: [blocks north, avenues east]
  // blocks: positive = north, negative = south (up to 3)
  // avenues: positive = east, negative = west (up to 2)

  // Generate all combinations: blocks -3 to 3, avenues -2 to 2
  // excluding (0, 0) which is the origin
  for (let blocks = -3; blocks <= 3; blocks++) {
    for (let avenues = -2; avenues <= 2; avenues++) {
      if (blocks === 0 && avenues === 0) continue;

      // Calculate walk distance in feet (straight line)
      const walkDistanceFeet = Math.sqrt(
        Math.pow(blocks * BLOCK_FEET, 2) +
        Math.pow(avenues * AVENUE_FEET, 2)
      );

      // Walk time in seconds (distance in miles / speed in mph * 3600)
      const walkTimeSecs = (walkDistanceFeet / FEET_PER_MILE) / WALK_SPEED_MPH * 3600;

      // Skip candidates that exceed max walk time
      if (walkTimeSecs > MAX_WALK_TIME_SECS) continue;

      const latOffset = feetToLatDegrees(blocks * BLOCK_FEET);
      const lngOffset = feetToLngDegrees(avenues * AVENUE_FEET, originLat);

      const lat = originLat + latOffset;
      const lng = originLng + lngOffset;

      // Create direction label
      const directionParts = [];
      if (blocks !== 0) {
        const absBlocks = Math.abs(blocks);
        directionParts.push(`${absBlocks} block${absBlocks > 1 ? 's' : ''} ${blocks > 0 ? 'north' : 'south'}`);
      }
      if (avenues !== 0) {
        const absAvenues = Math.abs(avenues);
        directionParts.push(`${absAvenues} avenue${absAvenues > 1 ? 's' : ''} ${avenues > 0 ? 'east' : 'west'}`);
      }

      candidates.push({
        lat,
        lng,
        blocks,
        avenues,
        direction: directionParts.join(', '),
        walkTimeSecs,
        walkDistanceFeet
      });
    }
  }

  return candidates;
}

// Geocode an address
async function geocode(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK' || !data.results.length) {
    throw new Error(`Geocoding failed for "${address}": ${data.status}`);
  }

  const location = data.results[0].geometry.location;
  return {
    lat: location.lat,
    lng: location.lng,
    formattedAddress: data.results[0].formatted_address
  };
}

// Get drive times using Distance Matrix API (with batching for >25 origins)
async function getDriveTimes(origins, destination, departureTime = null) {
  const BATCH_SIZE = 25;
  const destStr = `${destination.lat},${destination.lng}`;
  const allResults = [];

  // Process in batches of 25
  for (let i = 0; i < origins.length; i += BATCH_SIZE) {
    const batch = origins.slice(i, i + BATCH_SIZE);
    const originsStr = batch.map(o => `${o.lat},${o.lng}`).join('|');

    let url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originsStr}&destinations=${destStr}&mode=driving&key=${API_KEY}`;

    // Add departure_time for traffic-based estimates
    if (departureTime) {
      url += `&departure_time=${departureTime}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      throw new Error(`Distance Matrix API failed: ${data.status}`);
    }

    const batchResults = data.rows.map((row, index) => {
      const element = row.elements[0];
      if (element.status !== 'OK') {
        return { index: i + index, durationSecs: null, durationText: 'N/A' };
      }
      // Use duration_in_traffic if available, otherwise regular duration
      const duration = element.duration_in_traffic || element.duration;
      return {
        index: i + index,
        durationSecs: duration.value,
        durationText: duration.text
      };
    });

    allResults.push(...batchResults);
  }

  return allResults;
}

// Format seconds to readable time
function formatTime(secs) {
  const mins = Math.round(secs / 60);
  if (mins < 60) {
    return `${mins} min`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours} hr ${remainingMins} min`;
}

// Config endpoint - returns API key for Places Autocomplete
app.get('/api/config', (req, res) => {
  res.json({ apiKey: API_KEY || null });
});

// Reverse geocode endpoint - convert lat/lng to address
app.get('/api/reverse-geocode', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.results.length > 0) {
      res.json({ address: data.results[0].formatted_address });
    } else {
      res.json({ address: null });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Main API endpoint
app.post('/api/calculate', async (req, res) => {
  try {
    const { origin, destination, departureTime } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ error: 'Origin and destination are required' });
    }

    if (!API_KEY) {
      return res.status(500).json({ error: 'Google Maps API key not configured' });
    }

    // Geocode both addresses
    const [originGeo, destGeo] = await Promise.all([
      geocode(origin),
      geocode(destination)
    ]);

    // Generate candidate pickup points
    const candidates = generateCandidates(originGeo.lat, originGeo.lng);

    // Get drive times for origin (direct) and all candidates in one batch
    const allOrigins = [
      { lat: originGeo.lat, lng: originGeo.lng },
      ...candidates.map(c => ({ lat: c.lat, lng: c.lng }))
    ];

    const driveTimes = await getDriveTimes(allOrigins, destGeo, departureTime);

    // Extract direct drive time (first result)
    const directDriveTime = driveTimes[0];
    if (directDriveTime.durationSecs === null) {
      return res.status(400).json({ error: 'Could not calculate direct route' });
    }

    // Process candidates
    const results = candidates.map((candidate, index) => {
      const driveTime = driveTimes[index + 1]; // +1 because first is direct
      if (driveTime.durationSecs === null) {
        return null;
      }

      const totalTimeSecs = candidate.walkTimeSecs + driveTime.durationSecs;
      const savedSecs = directDriveTime.durationSecs - totalTimeSecs;

      return {
        direction: candidate.direction,
        walkTimeSecs: candidate.walkTimeSecs,
        walkTimeText: formatTime(candidate.walkTimeSecs),
        driveTimeSecs: driveTime.durationSecs,
        driveTimeText: formatTime(driveTime.durationSecs),
        totalTimeSecs,
        totalTimeText: formatTime(totalTimeSecs),
        savedSecs,
        savedMins: Math.round(savedSecs / 60 * 10) / 10,
        walkDistanceFeet: Math.round(candidate.walkDistanceFeet)
      };
    }).filter(r => r !== null);

    // Filter to candidates that beat or come within 1 minute of baseline
    const validResults = results.filter(r => r.savedSecs >= -60);

    // Sort by total time (best first)
    validResults.sort((a, b) => a.totalTimeSecs - b.totalTimeSecs);

    res.json({
      origin: originGeo.formattedAddress,
      destination: destGeo.formattedAddress,
      directDriveTimeSecs: directDriveTime.durationSecs,
      directDriveTimeText: formatTime(directDriveTime.durationSecs),
      candidates: validResults,
      totalCandidatesChecked: candidates.length
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Walk-First server running at http://localhost:${PORT}`);
});
