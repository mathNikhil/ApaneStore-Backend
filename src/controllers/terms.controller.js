const { TERMS_VERSION, TERMS_TEXT } = require('../config/terms');

const TermsController = {
    // GET /api/terms
    getCurrent: (req, res) => {
        res.json({ success: true, data: { version: TERMS_VERSION, text: TERMS_TEXT } });
    },
};

module.exports = TermsController;
