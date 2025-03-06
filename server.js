require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const winston = require("winston");

const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: "error.log", level: "error" }),
        new winston.transports.File({ filename: "combined.log" }),
    ],
});

if (process.env.NODE_ENV !== "production") {
    logger.add(new winston.transports.Console());
}

const app = express();
app.use(express.json());
app.use(cors());

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, "sessions") }),
    puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        timeout: 30000,
    },
});

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_HOST_USER,
        pass: process.env.EMAIL_HOST_PASSWORD,
    },
});

let isReconnecting = false;

client.on("qr", async (qr) => {
    logger.info("QR code generated");
    console.log("Scan this QR code to log in:");

    const qrPath = path.join(__dirname, "qrcode.png");
    await qrcode.toFile(qrPath, qr);

    transporter.sendMail({
        from: process.env.EMAIL_HOST_USER,
        to: process.env.EMAIL_HOST_USER,
        subject: "New WhatsApp QR Code",
        text: "Scan the attached QR code to log in.",
        attachments: [{ filename: "qrcode.png", path: qrPath }],
    }).then(() => {
        console.log("QR Code sent via email!");
        fs.unlink(qrPath, (err) => {
            if (err) logger.error("Failed to delete QR code file:", err);
        });
    }).catch((err) => logger.error("Email send failed:", err));
});

client.on("ready", () => {
    logger.info("WhatsApp bot is ready!");
    console.log("WhatsApp bot is ready!");
});

client.on("disconnected", (reason) => {
    logger.warn("Client disconnected:", reason);
    console.log("Client disconnected:", reason);
    if (!isReconnecting) {
        isReconnecting = true;
        setTimeout(() => {
            client.initialize().catch((err) => {
                logger.error("Reconnection failed:", err);
                isReconnecting = false;
            });
        }, 5000);
    }
});

client.on("auth_failure", (msg) => {
    logger.error("Authentication failure:", msg);
    console.error("Authentication failure:", msg);
});

app.post("/send", async (req, res) => {
    const { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ error: "Phone and message are required" });
    }

    if (!client.info) {
        return res.status(503).json({ error: "WhatsApp client not ready" });
    }

    try {
        logger.info(`Sending message to ${phone}: ${message}`);
        await client.sendMessage(`${phone}@c.us`, message);
        res.json({ status: "Message sent successfully!" });
    } catch (error) {
        logger.error("WhatsApp Message Error:", error);
        res.status(500).json({ error: "Failed to send message", details: error.message });
    }
});

app.get("/health", (req, res) => {
    res.json({ status: client.info ? "connected" : "disconnected" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => logger.info(`WhatsApp Bot running on port ${PORT}`));

client.initialize().catch((err) => logger.error("Client initialization failed:", err));