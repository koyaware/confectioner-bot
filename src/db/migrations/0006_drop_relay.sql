-- Remove chat-with-master relay (v1.29): the relay_messages table is no longer used.
DROP TABLE IF EXISTS `relay_messages`;
