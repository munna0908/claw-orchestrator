import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryParticipantMappingStore,
  resetInMemoryStore,
} from '../src/stores/in-memory-store.js';
import { ChannelType } from '../src/types/index.js';

describe('InMemoryParticipantMappingStore', () => {
  let store: InMemoryParticipantMappingStore;

  beforeEach(() => {
    resetInMemoryStore();
    store = new InMemoryParticipantMappingStore();
  });

  describe('lookup', () => {
    it('should return not found for non-existent mapping', async () => {
      const result = await store.lookup({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
      });

      expect(result.found).toBe(false);
      expect(result.mapping).toBeUndefined();
    });

    it('should return mapping when it exists', async () => {
      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
        moiAccountId: 'moi_abc',
      });

      const result = await store.lookup({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
      });

      expect(result.found).toBe(true);
      expect(result.mapping).toBeDefined();
      expect(result.mapping?.externalUserId).toBe('user123');
      expect(result.mapping?.moiAccountId).toBe('moi_abc');
    });

    it('should update lastActiveAt on lookup', async () => {
      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
        moiAccountId: 'moi_abc',
      });

      const result1 = await store.lookup({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
      });

      const firstActiveAt = result1.mapping?.lastActiveAt;

      // Wait a tiny bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result2 = await store.lookup({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
      });

      expect(result2.mapping?.lastActiveAt.getTime()).toBeGreaterThanOrEqual(
        firstActiveAt?.getTime() ?? 0
      );
    });
  });

  describe('create', () => {
    it('should create a new mapping', async () => {
      const mapping = await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
        moiAccountId: 'moi_abc',
      });

      expect(mapping.id).toBeDefined();
      expect(mapping.channel).toBe(ChannelType.TELEGRAM);
      expect(mapping.externalUserId).toBe('user123');
      expect(mapping.moiAccountId).toBe('moi_abc');
      expect(mapping.createdAt).toBeInstanceOf(Date);
      expect(mapping.lastActiveAt).toBeInstanceOf(Date);
    });

    it('should throw error for duplicate mapping', async () => {
      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
        moiAccountId: 'moi_abc',
      });

      await expect(
        store.create({
          channel: ChannelType.TELEGRAM,
          externalUserId: 'user123',
          moiAccountId: 'moi_xyz',
        })
      ).rejects.toThrow('Participant mapping already exists');
    });

    it('should allow same user on different channels', async () => {
      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
        moiAccountId: 'moi_abc',
      });

      const whatsappMapping = await store.create({
        channel: ChannelType.WHATSAPP,
        externalUserId: 'user123',
        moiAccountId: 'moi_abc',
      });

      expect(whatsappMapping.channel).toBe(ChannelType.WHATSAPP);
    });
  });

  describe('delete', () => {
    it('should delete existing mapping', async () => {
      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
        moiAccountId: 'moi_abc',
      });

      const deleted = await store.delete({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
      });

      expect(deleted).toBe(true);

      const result = await store.lookup({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
      });

      expect(result.found).toBe(false);
    });

    it('should return false for non-existent mapping', async () => {
      const deleted = await store.delete({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'nonexistent',
      });

      expect(deleted).toBe(false);
    });
  });

  describe('findByMoiAccountId', () => {
    it('should find all mappings for a MOI account', async () => {
      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user123',
        moiAccountId: 'moi_abc',
      });

      await store.create({
        channel: ChannelType.WHATSAPP,
        externalUserId: '+1234567890',
        moiAccountId: 'moi_abc',
      });

      const mappings = await store.findByMoiAccountId('moi_abc');

      expect(mappings).toHaveLength(2);
      expect(mappings.map((m) => m.channel)).toContain(ChannelType.TELEGRAM);
      expect(mappings.map((m) => m.channel)).toContain(ChannelType.WHATSAPP);
    });

    it('should return empty array for unknown account', async () => {
      const mappings = await store.findByMoiAccountId('unknown');

      expect(mappings).toHaveLength(0);
    });
  });

  describe('getCount', () => {
    it('should return correct count', async () => {
      expect(store.getCount()).toBe(0);

      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user1',
        moiAccountId: 'moi_1',
      });

      expect(store.getCount()).toBe(1);

      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user2',
        moiAccountId: 'moi_2',
      });

      expect(store.getCount()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all mappings', async () => {
      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user1',
        moiAccountId: 'moi_1',
      });

      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user2',
        moiAccountId: 'moi_2',
      });

      store.clear();

      expect(store.getCount()).toBe(0);
    });
  });
});
