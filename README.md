# An AWS image-resize server for Node.js

test-event.json 是AWS Lambda测试的event，可以修改一下进行测试

index.js 是 API Gateway对应的Lambda文件。

response.js 是 Cloudfront 上的Origin response节点上的Lambda文件。


## Build

Lambda

```bash
yarn create-zip
```

Lambda@edge 

```bash
yarn create-cloudFront-zip
```

