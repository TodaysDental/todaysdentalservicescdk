const isXRayEnabled = process.env.AWS_XRAY_TRACING_ENABLED === 'true';

let AWSXRay: any = null;

// Lazy load X-Ray SDK
function getXRaySDK() {
  if (!AWSXRay && isXRayEnabled) {
    try {
      AWSXRay = require('aws-xray-sdk-core');
    } catch (err) {
      console.warn('[X-Ray] SDK not available, tracing disabled');
      return null;
    }
  }
  return AWSXRay;
}

export function captureAsyncFunc<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!isXRayEnabled) {
    return fn();
  }

  const xray = getXRaySDK();
  if (!xray) {
    return fn();
  }

  return new Promise((resolve, reject) => {
    const segment = xray.getSegment();
    if (!segment) {
      fn().then(resolve).catch(reject);
      return;
    }

    const subsegment = segment.addNewSubsegment(name);
    
    fn()
      .then(result => {
        subsegment.close();
        resolve(result);
      })
      .catch(err => {
        subsegment.addError(err);
        subsegment.close();
        reject(err);
      });
  });
}

export function addAnnotation(key: string, value: string | number | boolean) {
  if (!isXRayEnabled) return;

  const xray = getXRaySDK();
  if (!xray) return;

  const segment = xray.getSegment();
  if (segment) {
    segment.addAnnotation(key, value);
  }
}

export function addMetadata(key: string, value: any) {
  if (!isXRayEnabled) return;

  const xray = getXRaySDK();
  if (!xray) return;

  const segment = xray.getSegment();
  if (segment) {
    segment.addMetadata(key, value);
  }
}
