var ShareLink = require("../models/shareLink");

module.exports.create = async (shareLink) => {
    return await ShareLink.create(shareLink);
};

module.exports.getByToken = async (token) => {
    return await ShareLink.findOne({ token: token }).exec();
};

module.exports.getAllByProject = async (projectId) => {
    return await ShareLink.find({ projectId: projectId }).sort({ createdAt: -1 }).exec();
};

module.exports.getOne = async (id) => {
    return await ShareLink.findById(id).exec();
};

module.exports.revoke = async (id) => {
    return await ShareLink.updateOne({ _id: id }, { revoked: true }).exec();
};