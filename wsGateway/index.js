const http = require("http");
const socketIo = require('socket.io');
const jwt = require("jsonwebtoken");

const { read_rabbit_msg } = require("./utils/rabbit_mq.js");
const httpServer = http.createServer();
httpServer.listen(4000);

const io = socketIo(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
    // options
});

io.on("connection", (socket) => {
    console.log("a user connected");

    const token = socket.handshake.auth.token;
    if (token != null) {
        jwt.verify(token, process.env.JWT_SECRET_KEY, (e, payload) => {
            if (e) {
                socket.emit('authError', e);
                return;
            }

            console.log("Connecting to room:", payload.id)
            socket.join(payload.id);

            socket.on('join-project', (projectId) => {
                console.log(`User ${payload.id} joining project room: ${projectId}`);
                socket.join(projectId);
            });
        });
    }

    socket.on("disconnect", () => {
        console.log("A user disconnected");
    });
});

// id do user como room id

function process_msg() {
    read_rabbit_msg('ws_queue', (msg) => {
        const msg_content = JSON.parse(msg.content.toString());
        const msg_id = msg_content.messageId;
        const timestamp = msg_content.timestamp
        const status = msg_content.status;
        const user = msg_content.user;

        console.log('Received msg:', JSON.stringify(msg_content));

        if (/update-client-preview/.test(msg_id)) {
            if (status == "error") {
                const error_code = msg_content.errorCode;
                const error_msg = msg_content.errorMsg;

                io.to(user).emit("preview-error", JSON.stringify({ 'error_code': error_code, 'error_msg': error_msg }));

                return;
            }

            const img_url = msg_content.img_url;

            io.to(user).emit("preview-ready", img_url);
        }

        else if (/update-client-process/.test(msg_id)) {
            if (status == "error") {
                const error_code = msg_content.errorCode;
                const error_msg = msg_content.errorMsg;

                io.to(user).emit("process-error", JSON.stringify({ 'error_code': error_code, 'error_msg': error_msg }));

                return;
            }

            if (msg_content.projectId) {
                io.to(msg_content.projectId).emit("process-update", msg_id);
            } else {
                io.to(user).emit("process-update", msg_id);
            }
        }

        else if (/update-project/.test(msg_id)) {
            io.to(user).emit("project-update");

            // Check for lock notifications in the payload
            /*if (msg_content.projectId && msg_content.projectId.action) {
                const action = msg_content.projectId.action;
                const data = msg_content.projectId;
                let message = "";

                if (action === "lock-acquired") {
                    message = `Lock acquired by ${data.userName}`;
                } else if (action === "lock-released") {
                    message = `Lock released by ${data.userName}`;
                } else if (action === "lock-expired") {
                    message = `Lock expired for ${data.userName}`;
                }

                if (message) {
                    io.to(user).emit("project-notification", {
                        originatorUserId: data.userId,
                        message: message
                    });
                }
            }*/
        }

        else if (msg_id === 'tool-added' || msg_id === 'image-added' || msg_id === 'image-deleted') {
            const { projectId, originatorUserId, message } = msg_content; // originatorUserId may be undefined
            if (projectId && message) { // Only check for the essentials
                io.to(projectId).emit("project-notification", {
                    originatorUserId: originatorUserId || null, // Send null if it's missing
                    message,
                });
            }
        }


    })
}

process_msg();
