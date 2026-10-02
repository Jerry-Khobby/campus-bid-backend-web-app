import { SOCKET_SERVER_OPTIONS, getAllowedOrigins, isAllowedOrigin } from './socket-origins';

describe('socket origins', () => {
  const originalOrigins = process.env.CORS_ORIGINS;

  afterEach(() => {
    if (originalOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = originalOrigins;
  });

  it('defaults to the three local frontends', () => {
    delete process.env.CORS_ORIGINS;

    expect(getAllowedOrigins()).toEqual([
      'http://localhost:5000',
      'http://localhost:5001',
      'http://localhost:5002',
    ]);
  });

  it('reads and trims the CORS_ORIGINS list', () => {
    process.env.CORS_ORIGINS = 'https://a.example, https://b.example';

    expect(getAllowedOrigins()).toEqual(['https://a.example', 'https://b.example']);
  });

  it('rejects an origin outside the list', () => {
    delete process.env.CORS_ORIGINS;

    expect(isAllowedOrigin('https://evil.example')).toBe(false);
  });

  it('accepts a configured origin', () => {
    delete process.env.CORS_ORIGINS;

    expect(isAllowedOrigin('http://localhost:5001')).toBe(true);
  });

  it('accepts a request without an Origin header', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  it('refuses the handshake of a foreign origin', () => {
    delete process.env.CORS_ORIGINS;
    const callback = jest.fn();

    SOCKET_SERVER_OPTIONS.allowRequest({ headers: { origin: 'https://evil.example' } } as any, callback);

    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('withholds CORS headers from a foreign origin', () => {
    delete process.env.CORS_ORIGINS;
    const callback = jest.fn();

    SOCKET_SERVER_OPTIONS.cors.origin('https://evil.example', callback);

    expect(callback).toHaveBeenCalledWith(null, false);
  });
});
