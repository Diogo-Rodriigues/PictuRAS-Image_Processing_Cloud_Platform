const { send_rabbit_msg, read_rabbit_msg } = require('./rabbit_mq')

const queues = {
    'cut': 'cut_queue',
    'scale': 'scale_queue',
    'border': 'border_queue',
    'saturation': 'saturation_queue',
    'brightness': 'brightness_queue',
    'contrast': 'contrast_queue',
    'binarization': 'binarization_queue',
    'resize': 'resize_queue',
    'rotate': 'rotate_queue',
    'cut_ai': 'cut_ai_queue',
    'upgrade_ai': 'upgrade_ai_queue',
    'bg_remove_ai': 'bg_remove_ai_queue',
    'text_ai': 'text_ai_queue',
    'obj_ai': 'obj_ai_queue',
    'people_ai': 'people_ai_queue',
    'watermark': 'watermark_queue',
    'project': 'project_queue',
    'ws': 'ws_queue'
}

function send_msg_tool(msg_id, timestamp, og_img_uri, new_img_uri, tool, params) {
    const queue = queues[tool];
    const msg = {
        "messageId": msg_id,
        "timestamp": timestamp,
        "procedure": tool,
        "parameters": {
            "inputImageURI": og_img_uri,
            "outputImageURI": new_img_uri,
            ... params
        }
    };

    send_rabbit_msg(msg, queue);
}

function send_msg_client(msg_id, timestamp, user, projectId) {
    const queue = queues['ws'];
    const msg = {
        "messageId": msg_id,
        "timestamp": timestamp,
        "user": user,
        "status": 'success'
    };

    if (projectId) {
        msg.projectId = projectId;
    }

    send_rabbit_msg(msg, queue);
}

function send_msg_client_error(msg_id, timestamp, user, error_code, error_msg) {
    const queue = queues['ws'];
    const msg = {
        "messageId": msg_id,
        "timestamp": timestamp,
        "user": user,
        "status": "error",
        "errorCode": error_code,
        "errorMsg": error_msg
    };

    send_rabbit_msg(msg, queue);
}

function send_msg_client_preview(msg_id, timestamp, user, url) {
    const queue = queues['ws'];
    const msg = {
        "messageId": msg_id,
        "timestamp": timestamp,
        "status": 'success',
        "user": user,
        "img_url": url
    };

    send_rabbit_msg(msg, queue);
}

function send_msg_client_preview_error(msg_id, timestamp, user, error_code, error_msg) {
    const queue = queues['ws'];
    const msg = {
        "messageId": msg_id,
        "timestamp": timestamp,
        "user": user,
        "status": "error",
        "errorCode": error_code,
        "errorMsg": error_msg
    };

    send_rabbit_msg(msg, queue);
}

function read_msg(callback){
    read_rabbit_msg(queues['project'], callback);
}

function send_tool_update_notification(projectId, originatorUserId, toolName) {
    const queue = queues['ws'];
    const msg = {
        "messageId": "tool-added",
        "projectId": projectId,
        "originatorUserId": originatorUserId,
        "message": `Tool '${toolName}' was added or updated in the project.`
    };

    send_rabbit_msg(msg, queue);
}

function send_image_update_notification(projectId, originatorUserId, imageName) {
    const queue = queues['ws'];
    const msg = {
        "messageId": "image-added",
        "projectId": projectId,
        "originatorUserId": originatorUserId,
        "message": `Image '${imageName}' was added to the project.`
    };

    send_rabbit_msg(msg, queue);
}

function send_image_delete_notification(projectId, originatorUserId, imageName) {
    const queue = queues['ws'];
    const msg = {
        "messageId": "image-deleted",
        "projectId": projectId,
        "originatorUserId": originatorUserId,
        "message": `Image '${imageName}' was deleted from the project.`
    };

    send_rabbit_msg(msg, queue);
}

module.exports = { send_msg_tool, send_msg_client, send_msg_client_error, send_msg_client_preview, send_msg_client_preview_error, read_msg, send_tool_update_notification, send_image_update_notification, send_image_delete_notification };