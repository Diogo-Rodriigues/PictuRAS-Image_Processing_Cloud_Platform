// Helper function to extract userId from JWT token
// Used in endpoints that need to validate lock ownership
function extractUserIdFromJWT(req, options = {}) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        if (options.noFallback) return null;
        return req.params.user; // Fallback to URL param
    }

    try {
        const jwt = require("jsonwebtoken");
        const payload = jwt.verify(token, process.env.JWT_SECRET_KEY || "lisan_al_gaib");
        return payload.id;
    } catch (err) {
        if (options.noFallback) return null;
        return req.params.user; // Fallback on error
    }
}


function extractUserFromJWT(req, options = {}) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        if (options.noFallback) return null;
        return { id: req.params.user, name: "Owner" }; // Fallback
    }

    try {
        const jwt = require("jsonwebtoken");
        const payload = jwt.verify(token, process.env.JWT_SECRET_KEY || "lisan_al_gaib");
        return {
            id: payload.id,
            name: payload.name || "Unknown User",
            email: payload.email
        };
    } catch (err) {
        if (options.noFallback) return null;
        return { id: req.params.user, name: "Owner" }; // Fallback
    }
}

module.exports = { extractUserIdFromJWT, extractUserFromJWT };
