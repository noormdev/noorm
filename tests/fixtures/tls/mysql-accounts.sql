ALTER USER 'noorm_tls'@'%' REQUIRE X509;
CREATE USER 'noorm_tls_password'@'%' IDENTIFIED BY 'noorm_tls';
GRANT SELECT ON noorm_tls_test.* TO 'noorm_tls_password'@'%';
