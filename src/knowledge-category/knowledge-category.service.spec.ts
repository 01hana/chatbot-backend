import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { KnowledgeCategory } from '../generated/prisma/client';
import { IntentService } from '../intent/intent.service';
import {
  KnowledgeCategoryOptionVm,
  KnowledgeCategoryRepository,
} from './knowledge-category.repository';
import { KnowledgeCategoryService } from './knowledge-category.service';

function makeCategory(overrides: Partial<KnowledgeCategory> = {}): KnowledgeCategory {
  return {
    id: 1,
    key: 'product-spec',
    label: '產品規格',
    description: '產品規格、尺寸、材質、型號等知識',
    defaultIntentLabel: 'product-inquiry',
    isActive: true,
    sortOrder: 20,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('KnowledgeCategoryService', () => {
  let service: KnowledgeCategoryService;
  let repository: jest.Mocked<KnowledgeCategoryRepository>;

  beforeEach(async () => {
    const mockRepository: Partial<jest.Mocked<KnowledgeCategoryRepository>> = {
      findActiveOptions: jest.fn(),
      findByKey: jest.fn(),
      findActiveByKey: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        KnowledgeCategoryService,
        { provide: KnowledgeCategoryRepository, useValue: mockRepository },
        {
          provide: IntentService,
          useValue: {
            getCachedTemplates: jest.fn().mockReturnValue([
              { title: 'product-inquiry', isActive: true },
              { title: 'general-faq', isActive: true },
              { title: 'inactive-intent', isActive: false },
            ]),
          },
        },
      ],
    }).compile();

    service = module.get(KnowledgeCategoryService);
    repository = module.get(KnowledgeCategoryRepository);
  });

  it('returns active category options from the repository', async () => {
    const options: KnowledgeCategoryOptionVm[] = [
      {
        label: '產品規格',
        value: 'product-spec',
        description: '產品規格、尺寸、材質、型號等知識',
        defaultIntentLabel: 'product-inquiry',
      },
    ];
    repository.findActiveOptions.mockResolvedValueOnce(options);

    await expect(service.findActiveOptions()).resolves.toBe(options);
  });

  it('creates a category after validating uniqueness and defaultIntentLabel', async () => {
    const created = makeCategory();
    repository.findByKey.mockResolvedValueOnce(null);
    repository.create.mockResolvedValueOnce(created);

    const result = await service.create({
      key: 'product-spec',
      label: '產品規格',
      defaultIntentLabel: 'product-inquiry',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'product-spec',
        label: '產品規格',
        defaultIntentLabel: 'product-inquiry',
        isActive: true,
        sortOrder: 0,
      }),
    );
    expect(result).toBe(created);
  });

  it('rejects duplicate category keys', async () => {
    repository.findByKey.mockResolvedValueOnce(makeCategory());

    await expect(
      service.create({ key: 'product-spec', label: '產品規格' }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects unknown or inactive defaultIntentLabel on create', async () => {
    repository.findByKey.mockResolvedValue(null);

    await expect(
      service.create({
        key: 'pricing-info',
        label: '報價資訊',
        defaultIntentLabel: 'missing-intent',
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create({
        key: 'inactive',
        label: 'Inactive',
        defaultIntentLabel: 'inactive-intent',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates defaultIntentLabel successfully', async () => {
    const existing = makeCategory();
    const updated = makeCategory({ defaultIntentLabel: 'general-faq' });
    repository.findByKey.mockResolvedValueOnce(existing);
    repository.update.mockResolvedValueOnce(updated);

    const result = await service.update('product-spec', { defaultIntentLabel: 'general-faq' });

    expect(repository.update).toHaveBeenCalledWith('product-spec', {
      defaultIntentLabel: 'general-faq',
    });
    expect(result).toBe(updated);
  });

  it('updates defaultIntentLabel to null', async () => {
    const existing = makeCategory();
    const updated = makeCategory({ defaultIntentLabel: null });
    repository.findByKey.mockResolvedValueOnce(existing);
    repository.update.mockResolvedValueOnce(updated);

    const result = await service.update('product-spec', { defaultIntentLabel: null });

    expect(repository.update).toHaveBeenCalledWith('product-spec', {
      defaultIntentLabel: null,
    });
    expect(result).toBe(updated);
  });

  it('throws NotFoundException when updating unknown key', async () => {
    repository.findByKey.mockResolvedValueOnce(null);

    await expect(service.update('missing-key', { label: 'Missing' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('soft deletes a category', async () => {
    const existing = makeCategory();
    const deleted = makeCategory({ isActive: false, deletedAt: new Date() });
    repository.findByKey.mockResolvedValueOnce(existing);
    repository.softDelete.mockResolvedValueOnce(deleted);

    const result = await service.softDelete('product-spec');

    expect(repository.softDelete).toHaveBeenCalledWith('product-spec');
    expect(result.isActive).toBe(false);
    expect(result.deletedAt).toBeInstanceOf(Date);
  });

  it('asserts active category and rejects inactive/deleted/missing categories', async () => {
    repository.findActiveByKey.mockResolvedValueOnce(makeCategory());
    await expect(service.assertActiveCategory('product-spec')).resolves.toEqual(
      expect.objectContaining({ key: 'product-spec' }),
    );

    repository.findActiveByKey.mockResolvedValueOnce(null);
    await expect(service.assertActiveCategory('inactive-category')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('resolves default intent label from an active category', async () => {
    repository.findActiveByKey.mockResolvedValueOnce(makeCategory());

    await expect(service.resolveDefaultIntentLabel('product-spec')).resolves.toBe(
      'product-inquiry',
    );
  });

  it('resolves null when category defaultIntentLabel is blank or null', async () => {
    repository.findActiveByKey.mockResolvedValueOnce(makeCategory({ defaultIntentLabel: null }));
    await expect(service.resolveDefaultIntentLabel('product-spec')).resolves.toBeNull();

    repository.findActiveByKey.mockResolvedValueOnce(makeCategory({ defaultIntentLabel: '   ' }));
    await expect(service.resolveDefaultIntentLabel('product-spec')).resolves.toBeNull();
  });
});
