
import express from 'express';
import cors from 'cors';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- Telegram Client Setup ---
const apiId = parseInt(process.env.API_ID || '0', 10);
const apiHash = process.env.API_HASH || '';
const sessionString = process.env.STRING_SESSION || '';

if (!apiId || !apiHash || !sessionString) {
  console.error(
    '❌ ERROR: API_ID, API_HASH, and STRING_SESSION must be set in .env'
  );
  console.error(
    '💡 Run "npx tsx src/get-session.ts" to generate your STRING_SESSION.'
  );
  process.exit(1);
}

const client = new TelegramClient(
  new StringSession(sessionString),
  apiId,
  apiHash,
  {
    connectionRetries: 5,
  }
);

// --- API Routes ---

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'online',
    message: 'Telegram MVP Backend is running!',
  });
});
// Fetch Telegram posts that contain a image
// --- Media Download Endpoint ---
app.get('/api/media/:id', async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    await client.connect();

    const channel = await client.getEntity('Ramamarket1');
    const [msg] = await client.getMessages(channel, { ids: [postId] });

    if (!msg || !msg.media) {
      await client.disconnect();
      return res.status(404).send('No media found');
    }

    // Download media buffer directly from Telegram
    // Inside app.get('/api/media/:id', ...)
const isVideo = !!(msg.video || (msg.document && msg.document.mimeType?.includes('video')));

const buffer = await client.downloadMedia(msg, {});
await client.disconnect();

if (buffer) {
  // Set correct MIME type so video players load it properly
  res.type(isVideo ? 'video/mp4' : 'image/jpeg');
  return res.send(buffer);

    } else {
      return res.status(500).send('Failed to download image');
    }
  } catch (error: any) {
    console.error('❌ Media Error:', error);
    res.status(500).send('Error retrieving media');
  }
});
// Fetch Telegram posts that contain a price
app.get('/api/posts', async (_req, res) => {
  let connected = false;

  try {
    await client.connect();
    connected = true;

    console.log('📥 Fetching and parsing posts from @Ramamarket1...');

    const channel = await client.getEntity('Ramamarket1');

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: 'Channel not found',
      });
    }

    // Fetch the latest 15 messages
    const messages = await client.getMessages(channel, {
      limit: 15,
    });

    const posts = messages
      // 1. Remove empty messages and service messages
      .filter((msg) => Boolean(msg.message?.trim()))

      // 2. Extract product information
      .map((msg) => {
        const text = msg.message || '';

        // Extract a price only when a number is followed by Birr currency.
        // Examples: 45,000 ብር | 45000 birr | 799 ብር
        const priceMatch = text.match(
  /(?:ዋጋ[፦:-]?\s*.*?)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:ብር|birr)/i
  );

        const price = priceMatch
          ? `${priceMatch[1].replace(/,/g, '')} Birr`
          : null;

        // 3. Extract product title
        const lines = text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        let title = 'Untitled Product';

        const skipKeywords =
          /አድራሻ|Swift Service|ይዘዙን|youtube|tiktok|facebook|telegram|ፒያሳ|ፍየል ቤት|ውስን ፍሬ/i;

        for (const line of lines) {
          if (skipKeywords.test(line)) {
            continue;
          }

          // Remove leading emojis and symbols
          let cleanLine = line
            .replace(/^[^\w\u1200-\u137F]+/, '')
            .trim();

          // Remove trailing emojis
          cleanLine = cleanLine
            .replace(
              /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+$/gu,
              ''
            )
            .trim();

          if (cleanLine.length > 4) {
            title = cleanLine;
            break;
          }
        }

        // 4. Generate a direct link to the Telegram post
        const link = `https://t.me/Ramamarket1/${msg.id}`;
// Check if the message contains video
const isVideo = !!(msg.video || (msg.document && msg.document.mimeType?.includes('video')));

return {
  id: msg.id,
  title: title,
  price: price,
  link: link,
  date: new Date(msg.date * 1000).toISOString(),
  views: msg.views || 0,
  hasMedia: !!msg.media,
  isVideo: isVideo, // 👈 New field
  snippet: text.replace(/\n/g, ' ').substring(0, 100) + '...'
};
      })

      // 5. Keep ONLY posts with a detected price
      .filter((post) => post.price !== null);

    console.log(`✅ Found ${posts.length} posts with prices.`);

    res.json({
      success: true,
      count: posts.length,
      data: posts,
    });
  } catch (error: unknown) {
    console.error('❌ Scraper Error:', error);

    const message =
      error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      success: false,
      message: 'Failed to fetch posts',
      error: message,
    });
  } finally {
    // Disconnect whether the request succeeds or fails
    if (connected) {
      try {
        await client.disconnect();
      } catch (disconnectError) {
        console.error(
          '⚠️ Error disconnecting Telegram client:',
          disconnectError
        );
      }
    }
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`🚀 Server is running at http://localhost:${port}`);
  console.log(`📡 Test the API at: http://localhost:${port}/api/posts`);
});
