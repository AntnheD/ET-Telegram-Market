import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

const apiId = parseInt(process.env.API_ID || '0');
const apiHash = process.env.API_HASH || '';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query: string) => new Promise<string>((resolve) => rl.question(query, resolve));

async function main() {
    console.log('🔌 Starting Telegram Login...\n');
    const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

    await client.start({
        phoneNumber: async () => await ask('📱 Enter phone number (e.g., +251...): '),
        password: async () => await ask('🔒 Enter 2FA password (if any, else press Enter): '),
        phoneCode: async () => await ask('🔑 Enter the code from your Telegram app: '),
        onError: (err) => console.log('❌ Error:', err),
    });

    console.log('\n✅ SUCCESS! Copy the string below and paste it into your .env file as STRING_SESSION:\n');
    console.log('-------------------------------------------------------------------');
    console.log(client.session.save());
    console.log('-------------------------------------------------------------------\n');
    
    process.exit(0); // Close the script when done
}

main();