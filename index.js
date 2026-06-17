import makeWASocket, { DisconnectReason, useMultiFileAuthState, downloadContentFromMessage } from '@whiskeysockets/baileys';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pino from 'pino';
import sharp from 'sharp';

const phoneNumber = process.env.PHONE_NUMBER.replace(/^0/, '92');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ['Free AI Bot', 'Chrome', '120.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        console.log('CONNECTION:', connection);
        
        if (connection === 'connecting' &&!state.creds.registered) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const code = await sock.requestPairingCode(phoneNumber);
            console.log('====== 8 DIGIT CODE ======');
            console.log(code);
            console.log('==========================');
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('BOT CONNECTED!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "";
        try {
            if (!text.startsWith('.') && text) {
                await sock.sendPresenceUpdate('composing', sender);
                const result = await model.generateContent(`You are a helpful WhatsApp AI assistant. Reply in Urdu or Roman Urdu. User said: ${text}`);
                await sock.sendMessage(sender, { text: result.response.text() });
            }
            if (text.startsWith('.sticker') && msg.message.imageMessage) {
                await sock.sendMessage(sender, { text: 'Sticker ban raha hai...' });
                const stream = await downloadContentFromMessage(msg.message.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                const sticker = await sharp(buffer).resize(512, 512).webp().toBuffer();
                await sock.sendMessage(sender, { sticker: sticker });
            }
            if (msg.message.imageMessage && text &&!text.startsWith('.sticker')) {
                await sock.sendPresenceUpdate('composing', sender);
                const stream = await downloadContentFromMessage(msg.message.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                const imagePart = { inlineData: { data: buffer.toString('base64'), mimeType: 'image/jpeg' } };
                const result = await model.generateContent([text, imagePart]);
                await sock.sendMessage(sender, { text: result.response.text() });
            }
            if (text === '.help') {
                const helpText = `*FREE AI BOT COMMANDS* 🤖\n\n1. Koi bhi msg bhejo - AI se baat karo\n2. Photo + *.sticker* - Sticker banao\n3. Photo + sawal poocho - Image ka jawab milega\n4. *.help* - Ye list dekho\n\n*100% Free - Gemini AI*`;
                await sock.sendMessage(sender, { text: helpText });
            }
        } catch (e) {
            console.log(e);
            await sock.sendMessage(sender, { text: 'Error: ' + e.message });
        }
    });
}

startBot();
