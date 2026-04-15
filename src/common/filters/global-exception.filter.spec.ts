import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: { status: jest.Mock; json: jest.Mock };
  let mockRequest: { requestId?: string; headers: Record<string, string> };
  let mockHost: ArgumentsHost;

  function buildHost(req: typeof mockRequest): ArgumentsHost {
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: jest.fn().mockReturnValue(mockResponse),
        getRequest: jest.fn().mockReturnValue(req),
      }),
    } as unknown as ArgumentsHost;
  }

  beforeEach(() => {
    filter = new GlobalExceptionFilter();

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    mockRequest = {
      requestId: 'test-request-id',
      headers: {},
    };

    mockHost = buildHost(mockRequest);
  });

  // ─── 1. 404 ──────────────────────────────────────────────────────────────────

  describe('NotFoundException (404)', () => {
    it('should set HTTP status 404', () => {
      filter.catch(new NotFoundException('Resource not found'), mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    });

    it('should return the full standard error shape', () => {
      filter.catch(new NotFoundException('Resource not found'), mockHost);

      expect(mockResponse.json).toHaveBeenCalledWith({
        data: null,
        code: HttpStatus.NOT_FOUND,
        requestId: 'test-request-id',
        error: 'Resource not found',
      });
    });
  });

  // ─── 2. 400 (plain message) ───────────────────────────────────────────────────

  describe('BadRequestException (400, plain message)', () => {
    it('should set HTTP status 400', () => {
      filter.catch(new BadRequestException('Bad input'), mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    });

    it('should include code: 400 and error string in response', () => {
      filter.catch(new BadRequestException('Bad input'), mockHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: null, code: 400, error: 'Bad input' }),
      );
    });
  });

  // ─── 3. ValidationPipe 400 (object response with message array) ───────────────

  describe('BadRequestException (400, ValidationPipe shape)', () => {
    it('should extract message array as error field', () => {
      const exception = new BadRequestException({
        statusCode: 400,
        message: ['email must be a string', 'name should not be empty'],
        error: 'Bad Request',
      });

      filter.catch(exception, mockHost);

      const body = (mockResponse.json as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(body.code).toBe(400);
      expect(body.data).toBeNull();
      expect(Array.isArray(body.error)).toBe(true);
      expect(body.error).toContain('email must be a string');
    });
  });

  // ─── 4. Generic HttpException (custom status) ─────────────────────────────────

  describe('Generic HttpException', () => {
    it('should use the status code from the exception (418 Teapot)', () => {
      filter.catch(new HttpException('I am a teapot', HttpStatus.I_AM_A_TEAPOT), mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.I_AM_A_TEAPOT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: HttpStatus.I_AM_A_TEAPOT, error: 'I am a teapot' }),
      );
    });
  });

  // ─── 5. Unknown / non-HttpException errors ─────────────────────────────────────

  describe('Unknown / non-HttpException errors', () => {
    it('should return 500 for a plain Error', () => {
      filter.catch(new Error('DB connection failed'), mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 500, data: null }),
      );
    });

    it('should return 500 for a thrown string primitive', () => {
      filter.catch('something bad', mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('should return 500 for thrown null', () => {
      filter.catch(null, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  // ─── 6. No stack / internal message leak ──────────────────────────────────────

  describe('Stack trace / internal message is not leaked', () => {
    it('should NOT include the original error message in the response', () => {
      filter.catch(new Error('DB connection failed'), mockHost);

      const body = JSON.stringify((mockResponse.json as jest.Mock).mock.calls[0][0]);
      expect(body).not.toContain('DB connection failed');
    });

    it('should return the safe generic message "Internal server error"', () => {
      filter.catch(new Error('secret internal detail'), mockHost);

      const body = (mockResponse.json as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(body.error).toBe('Internal server error');
    });
  });

  // ─── 7. requestId propagation ─────────────────────────────────────────────────

  describe('requestId propagation', () => {
    it('should echo requestId from req.requestId', () => {
      filter.catch(new NotFoundException(), mockHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'test-request-id' }),
      );
    });

    it('should fall back to x-request-id header when req.requestId is absent', () => {
      const reqWithHeader = { headers: { 'x-request-id': 'header-id-456' } };
      filter.catch(new NotFoundException(), buildHost(reqWithHeader));

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'header-id-456' }),
      );
    });

    it('should use empty string when neither source provides a requestId', () => {
      const reqEmpty = { headers: {} };
      filter.catch(new NotFoundException(), buildHost(reqEmpty));

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: '' }),
      );
    });
  });

  // ─── 8. Response contract consistency ─────────────────────────────────────────

  describe('Response contract — all error types', () => {
    const cases: [string, unknown][] = [
      ['NotFoundException', new NotFoundException()],
      ['BadRequestException', new BadRequestException()],
      ['Generic HttpException', new HttpException('oops', 422)],
      ['Unknown Error', new Error('boom')],
    ];

    it.each(cases)('%s must always include data/code/requestId/error keys', (_label, exception) => {
      filter.catch(exception, mockHost);

      const body = (mockResponse.json as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(body).toHaveProperty('data', null);
      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('requestId');
      expect(body).toHaveProperty('error');
    });
  });
});

