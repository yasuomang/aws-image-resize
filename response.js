'use strict';

const AWS = require('aws-sdk');
const Sharp = require('sharp');

const S3 = new AWS.S3({ signatureVersion: 'v4' });

// environment variables
let BUCKET = process.env.BUCKET;
const WHITELISTED_DIMENSIONS = process.env.WHITELISTED_DIMENSIONS
    ? Object.freeze(process.env.WHITELISTED_DIMENSIONS.split(' '))
    : null;

const DEFAULT_CACHE_HEADER = 'public, max-age=86400';
const FIT_OPTIONS = [
    'cover',    // Preserving aspect ratio, ensure the image covers both provided dimensions by cropping/clipping to fit. (default)
    'contain',  // Preserving aspect ratio, contain within both provided dimensions using "letterboxing" where necessary.
    'fill',     // Ignore the aspect ratio of the input and stretch to both provided dimensions.
    'inside',   // Preserving aspect ratio, resize the image to be as large as possible while ensuring its dimensions are less than or equal to both those specified.
    'outside',  // Preserving aspect ratio, resize the image to be as small as possible while ensuring its dimensions are greater than or equal to both those specified.
];

function getResource(resourcePath) {

    let params = {
        Bucket: BUCKET,
        Key: resourcePath
    };

    return new Promise((resolve, reject) => {
        S3.getObject(params, (err, data) => {
            if(err) {
                return resolve(false);
            }
            if(data) {
                return resolve(data);
            }
        })
    });
}

const PATH_SUFFIX = 'image-resize'

exports.handler = async (event, context, callback) => {
    let response = event.Records[0].cf.response;
    let request = event.Records[0].cf.request;
    let path = request.uri;
    BUCKET = BUCKET || request.origin.s3.domainName.split('.')[0];
    console.log('BUCKET', BUCKET);
    console.log('responseCode', response.status);
    console.log('path', path);
    if ((response.status == 403 || response.status == 404) && path.startsWith(`/${PATH_SUFFIX}`)) {
        // fetch the uri of original image
        path = path.replace(`/${PATH_SUFFIX}/`, '')
        let parts = path.split('/');
        const resizeOption = parts.shift();
        const sizeAndAction = resizeOption.split('_');
        const filename = parts.join('/');
        const sizes = sizeAndAction[0].split('x');
        const action = sizeAndAction.length > 1 ? sizeAndAction[1] : 'cover';

        const allowedMimeTypes = [
            'image/jpeg',
            'image/gif',
            'image/png',
            'image/svg+xml',
            'image/tiff',
            'image/bmp',
            'binary/octet-stream',
            'application/octet-stream'
        ];

        const unsupportedSharpMimeTypes = [
            'image/bmp'
        ];

        // validate requested image dimension against whitelisted dimensions.
        if (WHITELISTED_DIMENSIONS && !WHITELISTED_DIMENSIONS.includes(sizeAndAction[0])) {
            response.code = 400;
            response.body = `WHITELIST is set but does not contain the size parameter "${sizeAndAction[0]}"`;
            response.headers['content-type'] = [{ key: 'Content-Type', value: 'text/plain' }];
            return callback(null, response);
        }

        // Fit validation
        if(action && (FIT_OPTIONS.indexOf(action) === -1)) {
            response.code = 400;
            response.body = `Unknown Fit action parameter "${action}"\n` +
            `Available Fit actions: ${FIT_OPTIONS.join(', ')}.`;
            response.headers['content-type'] = [{ key: 'Content-Type', value: 'text/plain' }];
            return callback(null, response);
        }

        // load original image.
        let originalImage = await getResource(filename);

        // check if image does not exist.
        if(!originalImage) {
            response.body = `Resource not found. Could not find resource: ${filename}.`;
            response.headers['content-type'] = [{ key: 'Content-Type', value: 'text/plain' }];
            // return 404.
            return callback(null, response);
        }

        const originalImageMime = originalImage.ContentType;
        if(!allowedMimeTypes.includes(originalImageMime)) {
            // return 400.
            response.code = 400;
            response.body = `Unsupported MIME type: ${originalImageMime}. Supported types: ${allowedMimeTypes.join(', ')}`;
            response.headers['content-type'] = [{ key: 'Content-Type', value: 'text/plain' }];
            return callback(null, response);
        }

        // handle unsupported Sharp images
        if(unsupportedSharpMimeTypes.includes(originalImageMime)) {
            response.status = 200;
            response.body = (Buffer.from(originalImage.Body)).toString('base64');
            response.bodyEncoding = 'base64';
            response.headers['content-type'] = [{ key: 'Content-Type', value: originalImageMime }];
        }

        const width = sizes[0] === 'auto' ? null : parseInt(sizes[0]);
        const height = sizes[1] === 'auto' ? null : parseInt(sizes[1]);
        const fit = action || 'cover';

        // create a new image using provided dimensions.
        const result = await Sharp(originalImage.Body, { failOnError: false })
            .resize(width, height, { withoutEnlargement: true, fit })
            .rotate()
            .toBuffer();


        // save newly created image to S3.
        await S3.putObject({
            Body: result,
            Bucket: BUCKET,
            ContentType: originalImageMime,
            Key: PATH_SUFFIX + '/' + path,
            CacheControl: DEFAULT_CACHE_HEADER,
            Expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 设置过期时间为30天后
        }).promise();


        // return created image as a response.
        response.status = 200;
        response.body = result.toString('base64');
        response.bodyEncoding = 'base64';
        response.headers['content-type'] = [{ key: 'Content-Type', value: originalImageMime }];
        return callback(null, response);
    }else {
        // allow the response to pass through
        return callback(null, response);
    }
}
