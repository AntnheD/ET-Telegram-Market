import express from 'express';
import cors from 'cors';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

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
  { connectionRetries: 5 }
);

// Configure multiple public channel usernames in .env.
// Example: TELEGRAM_CHANNELS=Ramamarket1,Leyueqa,modernshoppingcenter
const channelNames = [
  ...new Set(
    (process.env.TELEGRAM_CHANNELS || 'Ramamarket1')
      .split(',')
      .map((name) => name.trim().replace(/^@/, ''))
      .filter(Boolean)
  ),
];

let clientConnected = false;

async function connectTelegram(): Promise<void> {
  if (!clientConnected) {
    await client.connect();
    clientConnected = true;
  }
}

async function disconnectTelegram(): Promise<void> {
  if (clientConnected) {
    try {
      await client.disconnect();
    } finally {
      clientConnected = false;
    }
  }
}

function detectVideo(msg: any): boolean {
  const mimeType = msg?.document?.mimeType || '';
  return Boolean(msg?.video || String(mimeType).toLowerCase().startsWith('video/'));
}

// --- API Routes ---

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'online',
    message: 'Telegram MVP Backend is running!',
    configuredChannels: channelNames.length,
  });
});

// --- Media Download Endpoint ---
// Because Telegram message IDs can repeat between channels, provide ?channel=NAME
// when requesting media from a listing. The first configured channel is the fallback.
app.get('/api/media/:id', async (req, res) => {
  let connectedHere = false;

  try {
    const postId = parseInt(req.params.id, 10);

    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).send('Invalid post ID');
    }

    await connectTelegram();
    connectedHere = true;

    const requestedChannel = String(
      req.query.channel || channelNames[0] || ''
    ).trim().replace(/^@/, '');

    if (!requestedChannel) {
      return res.status(400).send('No Telegram channel configured');
    }

    const channel = await client.getEntity(requestedChannel);
    const [msg] = await client.getMessages(channel, { ids: [postId] });

    if (!msg || !msg.media) {
      return res.status(404).send('No media found');
    }

    const isVideo = detectVideo(msg);
    const buffer = await client.downloadMedia(msg, {});

    if (!buffer) {
      return res.status(500).send('Failed to download media');
    }

    const mimeType = isVideo
      ? (msg.document?.mimeType || 'video/mp4')
      : (msg.document?.mimeType || 'image/jpeg');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(Buffer.from(buffer as any));
  } catch (error: unknown) {
    console.error('❌ Media Error:', error);
    return res.status(500).send('Error retrieving media');
  } finally {
    if (connectedHere) {
      try {
        await disconnectTelegram();
      } catch (disconnectError) {
        console.error('⚠️ Error disconnecting Telegram client:', disconnectError);
      }
    }
  }
});

// --- Fetch Telegram posts containing a price from all configured channels ---
app.get('/api/posts', async (_req, res) => {
  let connectedHere = false;

  try {
    await connectTelegram();
    connectedHere = true;

    const allPosts: any[] = [];
    const channelErrors: { channel: string; error: string }[] = [];

    for (const channelName of channelNames) {
      try {
        console.log(`📥 Fetching and parsing posts from @${channelName}...`);

        const channel: any = await client.getEntity(channelName);
        const messages: any[] = await client.getMessages(channel, {
          limit: 15,
        });

        const posts = messages
          // 1. Remove empty messages and service messages
          .filter((msg) => Boolean(msg.message?.trim()))

          // 2. Extract product information
          .map((msg) => {
            const text = msg.message || '';

            // Matches examples: 45,000 ብር | 45000 birr | 799 ብር
            const priceMatch = text.match(
              /(?:ዋጋ[፦:-]?\s*.*?)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:ብር|birr|ETB)/i
            );

            const price = priceMatch
              ? `${priceMatch[1].replace(/,/g, '')} Birr`
              : null;

            // 3. Extract product title while preserving Amharic support
           const lines = text
            .split('\n')
            .map((line: string) => line.trim())
            .filter((line: string) => line.length > 0);

        let title = 'Untitled Product';

            const skipKeywords =
              /አድራሻ|Swift Service|ይዘዙን|youtube|tiktok|facebook|telegram|ፒያሳ|ፍየል ቤት|ውስን ፍሬ/i;

            for (const line of lines) {
              if (skipKeywords.test(line)) continue;

              // Remove leading symbols/emojis but retain Latin and Amharic text.
              let cleanLine = line
                .replace(/^[^\w\u1200-\u137F]+/u, '')
                .trim();

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

            // 4. Generate a direct link using the actual channel username.
            // Public channels have t.me links; private channels may not.
            const username = channel.username
              ? String(channel.username).replace(/^@/, '')
              : null;

            const link = username
              ? `https://t.me/${username}/${msg.id}`
              : null;

            return {
              id: Number(msg.id),
              channel: username || channelName,
              title,
              price,
              link,
              date: msg.date
                ? new Date(Number(msg.date) * 1000).toISOString()
                : null,
              views: Number(msg.views || 0),
              hasMedia: Boolean(msg.media),
              isVideo: detectVideo(msg),
              snippet: text.replace(/\s+/g, ' ').substring(0, 100) + (text.length > 100 ? '...' : ''),
            };
          })

          // 5. Keep ONLY posts with a detected price
          .filter((post) => post.price !== null);

        allPosts.push(...posts);
        console.log(`✅ Found ${posts.length} priced posts in @${channelName}.`);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';

        console.error(`❌ Error scraping @${channelName}:`, message);
        channelErrors.push({ channel: channelName, error: message });
      }
    }

    // Newest posts first across all channels
    allPosts.sort((a, b) => {
      const aTime = a.date ? Date.parse(a.date) : 0;
      const bTime = b.date ? Date.parse(b.date) : 0;
      return bTime - aTime;
    });

    console.log(`✅ Found ${allPosts.length} priced posts across configured channels.`);

    return res.json({
      success: true,
      count: allPosts.length,
      data: allPosts,
      ...(channelErrors.length > 0 ? { channelErrors } : {}),
    });
  } catch (error: unknown) {
    console.error('❌ Scraper Error:', error);

    const message =
      error instanceof Error ? error.message : 'Unknown error';

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch posts',
      error: message,
    });
  } finally {
    if (connectedHere) {
      try {
        await disconnectTelegram();
      } catch (disconnectError) {
        console.error('⚠️ Error disconnecting Telegram client:', disconnectError);
      }
    }
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`🚀 Server is running at http://localhost:${port}`);
  console.log(`📡 Test the API at: http://localhost:${port}/api/posts`);
  console.log(`📢 Configured channels: ${channelNames.map((name) => '@' + name).join(', ')}`);
});
