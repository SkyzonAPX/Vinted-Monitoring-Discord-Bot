import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

import ConfigurationManager from "./utils/config_manager.js";

const mongoConfig = ConfigurationManager.getMongoDBConfig

import Logger from "./utils/logger.js";

// Connect to MongoDB
mongoose.connect(mongoConfig.uri)
    .then(() => Logger.info("Connected to MongoDB."))
    .catch((err) => Logger.error(err));

const Preference = {
    Countries: "countries",
    Language: "language",
    Currency: "currency",
    Mention: "mention"
};

// Define your schemas
const userSchema = new Schema({
    discordId: { type: String, unique: true, required: true },
    channels: [{ type: Types.ObjectId, ref: 'VintedChannel' }],
    lastUpdated: { type: Date, default: Date.now },
    maxChannels: { type: Number, default: ConfigurationManager.getUserConfig.max_private_channels_default },
    preferences: { type: Map, default: {} },
});

const vintedChannelSchema = new Schema({
    channelId: { type: String, unique: true, required: true },
    lastUpdated: { type: Date, default: Date.now },
    name: { type: String, required: true },
    url: { type: String, default: null },
    keywords: { type: String, default: '' },
    isMonitoring: { type: Boolean, default: true },
    type: { type: String, default: 'public' },
    user: { type: Types.ObjectId, ref: 'User', default: null },
    preferences: { type: Map, default: {} },
});

// Create models
const User = model('User', userSchema);
const VintedChannel = model('VintedChannel', vintedChannelSchema);

Logger.info("Database models loaded.");

export { Preference, User, VintedChannel };