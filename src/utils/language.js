import fs from 'fs';
import path from 'path';
import Logger from './logger.js';

const __dirname = path.resolve();

/**
 * Don't dare to touch this file or you will be cursed by the gods of localization.
 */
class LanguageService {
    static localesDir = path.join(__dirname, 'locales');
    static languages = {};
    static fallbackLanguage = 'en-GB';

    static initialize() {
        const files = fs.readdirSync(this.localesDir);
        files.forEach(file => {
            const filePath = path.join(this.localesDir, file);
            const lang = path.basename(file, '.json');
            Logger.info(`Loading language file for ${lang}`);
            this.languages[lang] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        });
    }

    static getText(lang, key) {
        if (!this.languages[lang]) {
            console.warn(`Language ${lang} not found, falling back to ${this.fallbackLanguage}`);
            lang = this.fallbackLanguage;
        }

        if (this.languages[lang] && this.languages[lang][key]) {
            return this.languages[lang][key];
        }

        if (lang !== this.fallbackLanguage && this.languages[this.fallbackLanguage] && this.languages[this.fallbackLanguage][key]) {
            return this.languages[this.fallbackLanguage][key];
        }

        return `Missing translation for "${key}"`;
    }
}

LanguageService.initialize();

export default LanguageService;
