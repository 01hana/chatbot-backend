import { ArgumentsHost, BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { describe, beforeEach, it } from 'node:test';

/**
 * Unit tests for GlobalExceptionFilter.
 *
 * All HTTP context objects are manually mocked so no running application or
 * database is required.
 */
describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: { status: jest.Mock; json: jest.Mock };
  let mockRequest: { requestId?: string; headers: Record<string, string> };
  let mockHost: ArgumentsHost;

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

    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: jest.fn().mockReturnValue(mockResponse),
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    } as unknown as ArgumentsHost;
  });

  describe('HttpException handling', () => {
    it('should return 404 for NotFoundException', () => {
      const exception = new NotFoundException('Resource not found');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: HttpStatus.NOT_FOUND }),
      );
    });

    it('should return 400 for BadRequestException', () => {
      const exception = new BadRequestException('Bad input');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: HttpStatus.BAD_REQUEST }),
      );
    });

    it('should include data: null in the response', () => {
      const exception = new NotFoundException();

      filter.catch(exception, mockHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: null }),
      );
    });

    it('should include the requestId in the response', () => {
      const exception = new NotFoundException();

      filter.catch(exception, mockHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'test-request-id' }),
      );
    });
  });

  describe('ValidationError (BadRequestException from ValidationPipe)', () => {
    it('should return 400 with an array of validation messages', () => {
      const exception = new BadRequestException({
        statusCode: 400,
        message: ['email must be a string', 'name should not be empty'],
        error: 'Bad Request',
      });

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.code).toBe(400);
      expect(Array.isArray(jsonArg.error)).toBe(true);
    });
  });

  describe('Unknown / unexpected error handling', () => {
    it('should return 500 for a non-HttpException error', () => {
      const exception = new Error('Something went horribly wrong');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: HttpStatus.INTERNAL_SERVER_ERROR }),
      );
    });

    it('should NOT leak the internal stack trace in the response', () => {
      const exception = new Error('DB connection failed');

      filter.catch(exception, mockHost);

      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(JSON.stringify(jsonArg)).not.toContain('DB connection failed');
      expect(jsonArg.error).toBe('Internal server error');
    });

    it('should return 500 for thrown non-Error primitives', () => {
      filter.catch('some string thrown', mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });

    it('should return 500 for thrown null', () => {
      filter.catch(null, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });
  });

  describe('HttpException with custom status', () => {
    it('should use the status code from a generic HttpException', () => {
      const exception = new HttpException('Teapot', HttpStatus.I_AM_A_TEAPOT);

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.I_AM_A_TEAPOT);
    });
  });
});
function expect(status: jest.Mock) {
    throw new Error('Function not implemented.');
}

